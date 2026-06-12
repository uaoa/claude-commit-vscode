import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import { findClaudeCliPath } from "./detection";
import type { ProgressCallback, Model } from "../types";
import { log, logError, logCommand } from "../utils/logger";

const CLI_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const CLI_SPEEDUP_ENV: Record<string, string> = {
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
};

const BASE_CLI_ARGS = ["-p", "--no-session-persistence", "--tools", "", "--effort", "low"];

// Without these the CLI boots every MCP server from the user's global config
// and injects user CLAUDE.md/rules and hooks, which slows every call and
// steers output away from the commit message; auth still applies without
// setting sources. Older CLI versions don't know these flags — see the
// fallback in runClaudeCliIsolated.
const ISOLATION_ARGS = ["--strict-mcp-config", "--setting-sources", ""];

// null = not probed yet; probed once per extension-host session.
let isolationFlagsSupported: boolean | null = null;

interface CliResult {
  stdout: string;
  stderr: string;
}

type CliError = Error & { killed?: boolean; code?: string; stderr?: string; stdout?: string };

function isUnknownOptionError(error: unknown): boolean {
  const err = error as CliError;
  return `${err.message ?? ""}\n${err.stderr ?? ""}`.toLowerCase().includes("unknown option");
}

async function runClaudeCliIsolated(cliPath: string, args: string[], stdin: string): Promise<CliResult> {
  if (isolationFlagsSupported === false) {
    return runClaudeCli(cliPath, args, stdin);
  }

  try {
    const result = await runClaudeCli(cliPath, [...ISOLATION_ARGS, ...args], stdin);
    isolationFlagsSupported = true;
    return result;
  } catch (error) {
    if (isolationFlagsSupported === null && isUnknownOptionError(error)) {
      isolationFlagsSupported = false;
      log("CLI does not support isolation flags (older version), retrying without them");
      return runClaudeCli(cliPath, args, stdin);
    }
    throw error;
  }
}

function runClaudeCli(cliPath: string, args: string[], stdin: string): Promise<CliResult> {
  const env = {
    ...process.env,
    ...CLI_SPEEDUP_ENV,
    // nvm/npm-global installs are `#!/usr/bin/env node` shims; node sits next to them.
    PATH: `${path.dirname(cliPath)}${path.delimiter}${process.env.PATH ?? ""}`,
  };

  // .cmd/.bat wrappers on Windows only run through a shell.
  const useShell = process.platform === "win32";
  const command = useShell && cliPath.includes(" ") ? `"${cliPath}"` : cliPath;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: useShell, windowsHide: true });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CLI_TIMEOUT_MS);

    const fail = (error: CliError): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      error.stderr = error.stderr ?? stderr;
      error.stdout = error.stdout ?? stdout;
      reject(error);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        fail(new Error("CLI output exceeded buffer limit"));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (error: CliError) => {
      fail(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (timedOut) {
        const error: CliError = new Error("CLI process timed out");
        error.killed = true;
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
        return;
      }

      if (code !== 0) {
        const error: CliError = new Error(`CLI exited with code ${code}`);
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });

    // Ignore EPIPE when the process dies before reading stdin; close/error report the real failure.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

function toCliError(error: unknown, cliPath: string): Error {
  const err = error as CliError;
  if (err.killed) {
    return new Error("CLI process timed out after 2 minutes. Try a smaller diff or check your connection.");
  }
  if (err.code === "ENOENT") {
    return new Error(`CLI executable not found at: ${cliPath}`);
  }
  const stderr = err.stderr?.trim() || "";
  const stdout = err.stdout?.trim() || "";
  const details: string[] = [];
  if (stderr) {
    details.push(`stderr: ${stderr}`);
  }
  if (stdout) {
    details.push(`stdout: ${stdout}`);
  }
  const baseMessage = err.message || String(error);
  const detailStr = details.length > 0 ? ` [${details.join("; ")}]` : "";
  const fullError = `CLI execution failed: ${baseMessage}${detailStr}`;
  logError(fullError, error);
  return new Error(fullError);
}

/**
 * Strip markdown code fences (```...```) from Claude's output.
 * Handles cases where the model wraps the commit message in a fenced block
 * despite instructions not to.
 */
function stripCodeFences(text: string): string {
  let result = text;

  // Match ```optional-lang\n...\n``` (entire fenced block) and extract content
  const fullFenceMatch = result.match(/```[^\n]*\n([\s\S]*?)\n```/);
  if (fullFenceMatch) {
    result = fullFenceMatch[1];
  } else {
    // Remove dangling fence markers anywhere (opening ```lang or closing ```)
    result = result.replace(/^[ \t]*```[^\n]*$/gmu, "");
  }

  return result.trim();
}

export async function generateWithCLI(
  prompt: string,
  progressCallback: ProgressCallback | null = null
): Promise<string> {
  const cliPath = await findClaudeCliPath();

  if (!cliPath) {
    throw new Error("Claude CLI path not found");
  }

  log(`Found Claude CLI at: ${cliPath}`);

  const config = vscode.workspace.getConfiguration("claudeCommit");
  const model = config.get<Model>("model", "haiku");

  if (progressCallback) {
    progressCallback(`Using ${model} model...`);
  }

  const args = [...BASE_CLI_ARGS, "--model", model];
  logCommand(`${cliPath} ${args.join(" ")}`);

  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await runClaudeCliIsolated(cliPath, args, prompt));
  } catch (error) {
    throw toCliError(error, cliPath);
  }

  if (stderr) {
    log(`CLI stderr: ${stderr.trim()}`);
  }
  if (stdout) {
    log(`CLI stdout (first 500 chars): ${stdout.substring(0, 500)}`);
  } else {
    log("CLI stdout is empty");
  }

  if (stderr && !stdout) {
    throw new Error(`CLI error output: ${stderr.trim()}`);
  }

  if (!stdout || stdout.trim().length === 0) {
    logError(
      "Empty response from CLI",
      new Error(`Command: ${cliPath} ${args.join(" ")}, stderr: ${stderr || "none"}`)
    );
    throw new Error("Empty response from CLI. Check Output panel for details.");
  }

  const cleanedStdout = stripCodeFences(stdout);

  const lines = cleanedStdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    logError("No valid lines in CLI output", new Error(`stdout: ${stdout}`));
    throw new Error("Empty response from CLI. Check Output panel for details.");
  }

  const multiLine = config.get<boolean>("multiLineCommit", false);
  if (multiLine) {
    const conventionalCommitPattern = /^(feat|fix|docs|style|refactor|test|chore|perf)(\(.+?\))?:.+/;
    let startIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (conventionalCommitPattern.test(lines[i])) {
        startIndex = i;
        break;
      }
    }

    // Use the non-trimmed cleaned stdout to preserve blank lines between subject/body/footer.
    const preserveBlankLines = cleanedStdout.split("\n").map((line) => line.replace(/\s+$/u, ""));

    // Drop leading empty lines
    while (preserveBlankLines.length > 0 && preserveBlankLines[0].trim().length === 0) {
      preserveBlankLines.shift();
    }
    // Drop trailing empty lines
    while (preserveBlankLines.length > 0 && preserveBlankLines[preserveBlankLines.length - 1].trim().length === 0) {
      preserveBlankLines.pop();
    }

    if (startIndex >= 0) {
      // Find the same starting line in preserveBlankLines
      const target = lines[startIndex];
      const startInPreserve = preserveBlankLines.findIndex((l) => l.trim() === target);
      if (startInPreserve >= 0) {
        return preserveBlankLines.slice(startInPreserve).join("\n");
      }
      return lines.slice(startIndex).join("\n");
    }

    if (preserveBlankLines.length > 0) {
      return preserveBlankLines.join("\n");
    }
  }

  const conventionalCommitPattern = /^(feat|fix|docs|style|refactor|test|chore|perf)(\(.+?\))?:.+/;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (conventionalCommitPattern.test(lines[i])) {
      return lines[i];
    }
  }

  return lines[lines.length - 1] || "chore: update code";
}

export async function generateWithCLIManaged(
  prompt: string,
  systemPrompt: string,
  progressCallback: ProgressCallback | null = null
): Promise<string> {
  const cliPath = await findClaudeCliPath();

  if (!cliPath) {
    throw new Error("Claude CLI path not found");
  }

  if (progressCallback) {
    progressCallback("Using haiku model (managed mode)...");
  }

  const args = [...BASE_CLI_ARGS, "--model", "haiku"];
  // Windows runs through a shell (.cmd wrapper), where a multi-line system
  // prompt cannot be quoted safely — skipped there, as before.
  if (process.platform !== "win32") {
    args.push("--system-prompt", systemPrompt);
  }

  logCommand(`${cliPath} ${args.filter((a) => a !== systemPrompt).join(" ")}`);

  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await runClaudeCliIsolated(cliPath, args, prompt));
  } catch (error) {
    throw toCliError(error, cliPath);
  }

  if (stderr) {
    log(`CLI stderr: ${stderr.trim()}`);
  }
  if (stdout) {
    log(`CLI stdout (first 500 chars): ${stdout.substring(0, 500)}`);
  }

  if (stderr && !stdout) {
    throw new Error(`CLI error output: ${stderr.trim()}`);
  }

  return stripCodeFences(stdout) || "chore: update code";
}

export async function generateWithAPI(
  prompt: string,
  progressCallback: ProgressCallback | null = null
): Promise<string> {
  const config = vscode.workspace.getConfiguration("claudeCommit");
  const apiKey = config.get<string>("apiKey") || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not found. Set it in extension settings or environment variable.");
  }

  const modelSetting = config.get<Model>("model", "haiku");
  const modelMap: Record<Model, string> = {
    haiku: "claude-haiku-4-5-20251001",
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };
  const apiModel = modelMap[modelSetting] ?? modelMap.haiku;

  if (progressCallback) {
    progressCallback(`Connecting to Anthropic API (${modelSetting})...`);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require("@anthropic-ai/sdk");
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: apiModel,
      max_tokens: 1000,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    return stripCodeFences(message.content[0].text);
  } catch (error) {
    const err = error as Error & { code?: string; status?: number };
    if (err.code === "MODULE_NOT_FOUND") {
      throw new Error("Install @anthropic-ai/sdk to use API: npm install @anthropic-ai/sdk");
    }
    if (err.status === 401) {
      throw new Error("Invalid API key. Check your ANTHROPIC_API_KEY in settings.");
    }
    if (err.status === 429) {
      throw new Error("Rate limit exceeded. Please wait and try again.");
    }
    throw error;
  }
}
