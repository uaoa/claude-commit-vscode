import { execFile } from "child_process";
import { promisify } from "util";
import type { DiffResult, DiffSource } from "../types";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024;

// quotepath=off keeps non-ASCII file names readable in --stat instead of octal escapes
const GIT_BASE_ARGS = ["-c", "core.quotepath=off", "--no-pager"];

// A user's color.ui=always or diff.external would otherwise leak ANSI codes / tool output into the prompt
const DIFF_ARGS = ["diff", "--no-color", "--no-ext-diff"];

// Generated files that crowd real changes out of the truncated diff sent to Claude
const LOW_PRIORITY_FILE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|go\.sum)$|\.(min\.js|min\.css|map|snap)$/;

// Path of the git binary VS Code uses (git.path setting or auto-detected); falls back to PATH
let gitPath = "git";

export function setGitPath(path: string | undefined): void {
  if (path) {
    gitPath = path;
  }
}

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(gitPath, [...GIT_BASE_ARGS, ...args], {
    cwd: repoPath,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout || "";
}

/**
 * Move lock files and other generated output to the end of the diff so the
 * truncated prompt shows the meaningful changes first. Nothing is dropped.
 */
export function prioritizeDiff(diff: string): string {
  const sections = diff.split(/^(?=diff --git )/m);
  const important: string[] = [];
  const generated: string[] = [];
  for (const section of sections) {
    const header = section.split("\n", 1)[0];
    const file = header.match(/ b\/(.+)$/)?.[1] ?? "";
    (LOW_PRIORITY_FILE.test(file) ? generated : important).push(section);
  }
  return [...important, ...generated].join("");
}

async function getStagedDiff(repoPath: string): Promise<DiffResult> {
  const [diff, stats] = await Promise.all([
    git(repoPath, [...DIFF_ARGS, "--cached", "--unified=1"]),
    git(repoPath, [...DIFF_ARGS, "--cached", "--stat"]),
  ]);
  return { diff: prioritizeDiff(diff), stats };
}

async function hasCommits(repoPath: string): Promise<boolean> {
  try {
    await git(repoPath, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function getUntrackedFiles(repoPath: string): Promise<string> {
  try {
    const files = (await git(repoPath, ["ls-files", "--others", "--exclude-standard"])).trim();
    return files ? `Untracked files:\n${files}` : "";
  } catch {
    return "";
  }
}

async function getAllDiff(repoPath: string): Promise<DiffResult> {
  const repoHasCommits = await hasCommits(repoPath);

  let diff: string;
  let stats: string;

  if (repoHasCommits) {
    // Repository has commits - use HEAD to get all changes
    [diff, stats] = await Promise.all([
      git(repoPath, [...DIFF_ARGS, "HEAD", "--unified=1"]),
      git(repoPath, [...DIFF_ARGS, "HEAD", "--stat"]),
    ]);
  } else {
    // New repository without commits - combine staged and unstaged diffs
    const [stagedDiff, stagedStats, unstagedDiff, unstagedStats] = await Promise.all([
      git(repoPath, [...DIFF_ARGS, "--cached", "--unified=1"]),
      git(repoPath, [...DIFF_ARGS, "--cached", "--stat"]),
      git(repoPath, [...DIFF_ARGS, "--unified=1"]),
      git(repoPath, [...DIFF_ARGS, "--stat"]),
    ]);
    diff = [stagedDiff, unstagedDiff].filter(Boolean).join("\n");
    stats = [stagedStats, unstagedStats].filter(Boolean).join("\n");
  }

  // `git diff` never shows new files that are not added yet; list them so they are not ignored
  const untracked = await getUntrackedFiles(repoPath);
  stats = [stats, untracked].filter(Boolean).join("\n");

  return { diff: prioritizeDiff(diff), stats };
}

export async function getDiff(repoPath: string, diffSource: DiffSource = "auto"): Promise<DiffResult> {
  try {
    if (diffSource === "staged") {
      return await getStagedDiff(repoPath);
    }

    if (diffSource === "all") {
      return await getAllDiff(repoPath);
    }

    // Auto mode: try staged first, fall back to all if empty
    const staged = await getStagedDiff(repoPath);
    if (staged.diff.trim()) {
      return staged;
    }

    return await getAllDiff(repoPath);
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to get git diff: ${error.message}`);
  }
}
