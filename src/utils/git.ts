import { exec } from "child_process";
import { promisify } from "util";
import { DiffResult, DiffSource } from "../types";

const execAsync = promisify(exec);

async function getStagedDiff(repoPath: string): Promise<DiffResult> {
  const [diffResult, statsResult] = await Promise.all([
    execAsync("git diff --cached --unified=1", {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
    }),
    execAsync("git diff --cached --stat", {
      cwd: repoPath,
    }),
  ]);
  return { diff: diffResult.stdout || "", stats: statsResult.stdout || "" };
}

async function hasCommits(repoPath: string): Promise<boolean> {
  try {
    await execAsync("git rev-parse HEAD", { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

async function getAllDiff(repoPath: string): Promise<DiffResult> {
  const repoHasCommits = await hasCommits(repoPath);

  if (repoHasCommits) {
    // Repository has commits - use HEAD to get all changes
    const [diffResult, statsResult] = await Promise.all([
      execAsync("git diff HEAD --unified=1", {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
      }),
      execAsync("git diff HEAD --stat", {
        cwd: repoPath,
      }),
    ]);
    return { diff: diffResult.stdout || "", stats: statsResult.stdout || "" };
  }

  // New repository without commits - combine staged and unstaged diffs
  const [stagedDiff, stagedStats, unstagedDiff, unstagedStats] =
    await Promise.all([
      execAsync("git diff --cached --unified=1", {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
      }),
      execAsync("git diff --cached --stat", { cwd: repoPath }),
      execAsync("git diff --unified=1", {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
      }),
      execAsync("git diff --stat", { cwd: repoPath }),
    ]);

  const diff = [stagedDiff.stdout, unstagedDiff.stdout]
    .filter(Boolean)
    .join("\n");
  const stats = [stagedStats.stdout, unstagedStats.stdout]
    .filter(Boolean)
    .join("\n");

  return { diff, stats };
}

export async function getDiff(
  repoPath: string,
  diffSource: DiffSource = "auto"
): Promise<DiffResult> {
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
