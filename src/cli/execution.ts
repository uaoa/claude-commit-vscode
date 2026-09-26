import * as vscode from "vscode";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import { findClaudeCliPath } from "./detection";
import type { ProgressCallback, Model } from "../types";
import { log, logError, logCommand } from "../utils/logger";

const CLI_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const CLI_SPEEDUP_ENV: Record<string, string> = {
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  // A commit message needs no extended thinking: with it Haiku spends
  // 500-1500 output tokens (8-15s) on a one-line answer, without it ~1.5s.
  // Models that cannot turn thinking off are handled by the CLI itself.
  MAX_THINKING_TOKENS: "0",
};

// Matches the first line of a Conventional Commits message, incl. `type!:` breaking marker
const CONVENTIONAL_COMMIT_PATTERN = /^(feat|fix|docs|style|refactor|test|build|ci|chore|perf|revert)(\(.+?\))?!?:.+/;

const BASE_CLI_ARGS = ["-p", "--no-session-persistence", "--tools", "", "--effort", "low"];

// Keeps MCP servers out of the call — they slow generation and steer output
// away from the commit message. Does NOT use --setting-sources "": that also
// blocks the `user` source, which is where the CLI reads its login/auth
// state, breaking generation with "Not logged in" even for authenticated
// users (https://github.com/uaoa/claude-commit-vscode/issues/20).
const ISOLATION_ARGS = ["--strict-mcp-config"];

// null = not probed yet.
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

// .cmd/.bat wrappers (npm installs) on Windows only run through cmd.exe;
// native binaries (claude.exe from the installer or the VS Code extension)
// are spawned directly, which also keeps arguments intact.
function needsWindowsShell(cliPath: string): boolean {
  return process.platform === "win32" && !/\.exe$/i.test(cliPath);
}

// With `shell: true` Node joins arguments with plain spaces, so an empty
// argument (`--tools ""`) disappears and paths with spaces split apart.
function quoteForCmd(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^()%!]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

function killProcessTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    // child.kill() would only stop cmd.exe and leave claude running.
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }).on("error", () => {});
    return;
  }
  child.kill("SIGKILL");
}

function runClaudeCli(cliPath: string, args: string[], stdin: string): Promise<CliResult> {
  const env = {
    ...process.env,
    ...CLI_SPEEDUP_ENV,
    // nvm/npm-global installs are `#!/usr/bin/env node` shims; node sits next to them.
    PATH: `${path.dirname(cliPath)}${path.delimiter}${process.env.PATH ?? ""}`,
  };

  const useShell = needsWindowsShell(cliPath);
  const command = useShell ? quoteForCmd(cliPath) : cliPath;
  const spawnArgs = useShell ? args.map(quoteForCmd) : args;

  return new Promise((resolve, reject) => {
    const child = spawn(command, spawnArgs, { env, shell: useShell, windowsHide: true });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
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

    // setEncoding keeps multi-byte characters (Cyrillic, CJK, Hangul) intact across chunk boundaries
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        killProcessTree(child);
        fail(new Error("CLI output exceeded buffer limit"));
      }
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
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
    let startIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (CONVENTIONAL_COMMIT_PATTERN.test(lines[i])) {
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

  for (let i = lines.length - 1; i >= 0; i--) {
    if (CONVENTIONAL_COMMIT_PATTERN.test(lines[i])) {
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
  // .cmd wrappers run through cmd.exe, where a multi-line system prompt
  // cannot be quoted safely — skipped there, as before.
  if (!needsWindowsShell(cliPath)) {
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
