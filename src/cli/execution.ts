import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { findClaudeCliPath } from "./detection";
import { ProgressCallback, Model } from "../types";

const execAsync = promisify(exec);

export async function generateWithCLI(
  prompt: string,
  progressCallback: ProgressCallback | null = null
): Promise<string> {
  const cliPath = await findClaudeCliPath();

  if (!cliPath) {
    throw new Error("Claude CLI path not found");
  }

  const escapedCliPath = cliPath.includes(" ") ? `"${cliPath}"` : cliPath;

  const config = vscode.workspace.getConfiguration("claudeCommit");
  const model = config.get<Model>("model", "haiku");

  const tmpDir = os.tmpdir();
  const promptFile = path.join(
    tmpDir,
    `claude-commit-prompt-${Date.now()}.txt`
  );

  try {
    await fs.promises.writeFile(promptFile, prompt, "utf-8");

    if (progressCallback) {
      progressCallback(`Using ${model} model...`);
    }

    const command =
      process.platform === "win32"
        ? `type "${promptFile}" | ${escapedCliPath} -p --model ${model}`
        : `cat "${promptFile}" | ${escapedCliPath} -p --model ${model}`;

    const { stdout, stderr } = await execAsync(command, {
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });

    if (stderr && !stdout) {
      throw new Error(`CLI error output: ${stderr.trim()}`);
    }

    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      throw new Error("Empty response from CLI");
    }

    const multiLine = config.get<boolean>("multiLineCommit", false);
    if (multiLine) {
      const conventionalCommitPattern =
        /^(feat|fix|docs|style|refactor|test|chore|perf)(\(.+?\))?:.+/;
      let startIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (conventionalCommitPattern.test(lines[i])) {
          startIndex = i;
          break;
        }
      }

      if (startIndex >= 0) {
        return lines.slice(startIndex).join("\n");
      }
    }

    const conventionalCommitPattern =
      /^(feat|fix|docs|style|refactor|test|chore|perf)(\(.+?\))?:.+/;

    for (let i = lines.length - 1; i >= 0; i--) {
      if (conventionalCommitPattern.test(lines[i])) {
        return lines[i];
      }
    }

    return lines[lines.length - 1] || "chore: update code";
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { killed?: boolean };
    if (err.killed) {
      throw new Error(
        "CLI process timed out after 2 minutes. Try a smaller diff or check your connection."
      );
    }
    if (err.code === "ENOENT") {
      throw new Error(`CLI executable not found at: ${cliPath}`);
    }
    throw error;
  } finally {
    try {
      await fs.promises.unlink(promptFile);
    } catch {
      // Ignore deletion errors
    }
  }
}

export async function generateWithCLIManaged(
  prompt: string,
  repoPath: string,
  progressCallback: ProgressCallback | null = null
): Promise<string> {
  const cliPath = await findClaudeCliPath();

  if (!cliPath) {
    throw new Error("Claude CLI path not found");
  }

  const escapedCliPath = cliPath.includes(" ") ? `"${cliPath}"` : cliPath;

  const tmpDir = os.tmpdir();
  const promptFile = path.join(
    tmpDir,
    `claude-commit-prompt-${Date.now()}.txt`
  );

  try {
    await fs.promises.writeFile(promptFile, prompt, "utf-8");

    if (progressCallback) {
      progressCallback("Using haiku model (managed mode)...");
    }

    const command =
      process.platform === "win32"
        ? `type "${promptFile}" | ${escapedCliPath} -p --model haiku`
        : `cat "${promptFile}" | ${escapedCliPath} -p --model haiku`;

    const { stdout, stderr } = await execAsync(command, {
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
      cwd: repoPath,
    });

    if (stderr && !stdout) {
      throw new Error(`CLI error output: ${stderr.trim()}`);
    }

    return stdout.trim() || "chore: update code";
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { killed?: boolean };
    if (err.killed) {
      throw new Error(
        "CLI process timed out after 2 minutes. Try a smaller diff or check your connection."
      );
    }
    if (err.code === "ENOENT") {
      throw new Error(`CLI executable not found at: ${cliPath}`);
    }
    throw error;
  } finally {
    try {
      await fs.promises.unlink(promptFile);
    } catch {
      // Ignore deletion errors
    }
  }
}

export async function generateWithAPI(
  prompt: string,
  progressCallback: ProgressCallback | null = null
): Promise<string> {
  const config = vscode.workspace.getConfiguration("claudeCommit");
  const apiKey = config.get<string>("apiKey") || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not found. Set it in extension settings or environment variable."
    );
  }

  if (progressCallback) {
    progressCallback("Connecting to Anthropic API...");
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require("@anthropic-ai/sdk");
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    return message.content[0].text.trim();
  } catch (error) {
    const err = error as Error & { code?: string; status?: number };
    if (err.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "Install @anthropic-ai/sdk to use API: npm install @anthropic-ai/sdk"
      );
    }
    if (err.status === 401) {
      throw new Error(
        "Invalid API key. Check your ANTHROPIC_API_KEY in settings."
      );
    }
    if (err.status === 429) {
      throw new Error("Rate limit exceeded. Please wait and try again.");
    }
    throw error;
  }
}
