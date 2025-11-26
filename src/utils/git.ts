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

async function getAllDiff(repoPath: string): Promise<DiffResult> {
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
