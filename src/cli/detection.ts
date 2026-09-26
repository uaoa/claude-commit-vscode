import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { log } from "../utils/logger";

const execAsync = promisify(exec);

// Cache for found CLI path
let cachedCliPath: string | null = null;

// Detection sources, in the order they can be configured by the user
export type DetectionSource = "path" | "vscodeExtension" | "shellProfile" | "commonPaths";

const DEFAULT_DETECTION_ORDER: DetectionSource[] = ["path", "vscodeExtension", "shellProfile", "commonPaths"];

const CLAUDE_EXTENSION_ID = "anthropic.claude-code";

function getDetectionOrder(config: vscode.WorkspaceConfiguration): DetectionSource[] {
  const configured = config.get<string[]>("detectionOrder");
  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_DETECTION_ORDER;
  }

  const order = configured.filter((s): s is DetectionSource => DEFAULT_DETECTION_ORDER.includes(s as DetectionSource));

  // Keep unlisted sources as a fallback tail so a partial list never disables detection
  const missing = DEFAULT_DETECTION_ORDER.filter((s) => !order.includes(s));
  return [...order, ...missing];
}

function getCommonCliPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [];

  if (process.platform === "win32") {
    paths.push(
      // Native installer
      path.join(home, ".local", "bin", "claude.exe"),
      path.join(home, "AppData", "Roaming", "npm", "claude.cmd"),
      path.join(home, "AppData", "Local", "npm", "claude.cmd"),
      path.join(home, ".claude", "local", "claude.exe"),
      "C:\\Program Files\\nodejs\\claude.cmd",
      "C:\\Program Files (x86)\\nodejs\\claude.cmd"
    );
  } else {
    paths.push(
      "/usr/local/bin/claude",
      "/usr/bin/claude",
      "/opt/homebrew/bin/claude",
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".claude", "local", "claude"),
      path.join(home, ".nvm", "versions", "node", "*", "bin", "claude"),
      path.join(home, ".npm-global", "bin", "claude"),
      path.join(home, "bin", "claude")
    );
  }

  return paths;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    // Fallback for symlinks (e.g. WSL ~/.local/bin/claude -> versioned path)
    // and filesystems where X_OK check is unreliable. Resolve the symlink
    // and check the target for existence + executability.
    try {
      const resolved = await fs.promises.realpath(filePath);
      if (resolved !== filePath) {
        await fs.promises.access(resolved, fs.constants.X_OK);
        return true;
      }
    } catch {
      // Fall through
    }
    // Last resort: plain existence check. spawn() follows symlinks natively,
    // so if the path exists we let the shell decide whether it can execute it.
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"];

/**
 * npm installs an extensionless POSIX shell script next to claude.cmd, and
 * `where claude` may list it first. cmd.exe cannot run it, so on Windows
 * prefer a sibling with an executable extension.
 */
async function toWindowsExecutable(filePath: string): Promise<string> {
  if (process.platform !== "win32" || path.extname(filePath)) {
    return filePath;
  }
  for (const ext of WINDOWS_EXECUTABLE_EXTENSIONS) {
    if (await fileExists(filePath + ext)) {
      return filePath + ext;
    }
  }
  return filePath;
}

async function findCliWithGlob(pattern: string): Promise<string | null> {
  if (!pattern.includes("*")) {
    return (await fileExists(pattern)) ? pattern : null;
  }

  const parts = pattern.split("*");
  if (parts.length !== 2) return null;

  const baseDir = parts[0].slice(0, -1);
  const suffix = parts[1];

  try {
    const entries = await fs.promises.readdir(baseDir);
    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry, suffix.slice(1));
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return null;
}

function getExtensionsDirs(): string[] {
  const home = os.homedir();
  // Remote (`.vscode-server`) and local (`.vscode`) install roots, plus insiders
  // and popular forks. Non-existent dirs are skipped silently.
  return [
    ".vscode-server",
    ".vscode-server-insiders",
    ".vscode",
    ".vscode-insiders",
    ".cursor-server",
    ".cursor",
    ".windsurf-server",
    ".windsurf",
  ].map((dir) => path.join(home, dir, "extensions"));
}

function compareExtensionVersions(a: string, b: string): number {
  // Sort newest first: anthropic.claude-code-2.1.216-linux-x64
  const parse = (name: string) =>
    (name.slice(CLAUDE_EXTENSION_ID.length + 1).match(/^\d+(\.\d+)*/)?.[0] ?? "0").split(".").map(Number);

  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (vb[i] ?? 0) - (va[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

async function findCliInExtensionDir(extensionPath: string): Promise<string | null> {
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  const nativeBinaryDir = path.join(extensionPath, "resources", "native-binary");

  // Layout used by the official extension: resources/native-binary/claude
  const direct = path.join(nativeBinaryDir, binaryName);
  if (await fileExists(direct)) return direct;

  // Tolerate a per-platform subdirectory: resources/native-binary/<platform>/claude
  try {
    const entries = await fs.promises.readdir(nativeBinaryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(nativeBinaryDir, entry.name, binaryName);
      if (await fileExists(nested)) return nested;
    }
  } catch {
    // native-binary dir doesn't exist
  }

  return null;
}

/**
 * Look for the CLI bundled with the official Claude Code VS Code extension.
 * Works both locally and over Remote-SSH/WSL/devcontainers: the extension API
 * is tried first (it knows where the current extension host installed it),
 * with a scan of the well-known extension directories as fallback.
 */
async function findCliInVscodeExtensions(): Promise<string | null> {
  const installed = vscode.extensions.all.find((ext) => ext.id.toLowerCase() === CLAUDE_EXTENSION_ID);

  if (installed) {
    const found = await findCliInExtensionDir(installed.extensionUri.fsPath);
    if (found) {
      log(`Found CLI in installed VS Code extension: ${found}`);
      return found;
    }
  }

  for (const dir of getExtensionsDirs()) {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      continue;
    }

    const candidates = entries
      .filter((name) => name.toLowerCase().startsWith(`${CLAUDE_EXTENSION_ID}-`))
      .sort(compareExtensionVersions);

    for (const candidate of candidates) {
      const found = await findCliInExtensionDir(path.join(dir, candidate));
      if (found) {
        log(`Found CLI in VS Code extensions dir: ${found}`);
        return found;
      }
    }
  }

  return null;
}

async function findCliOnPath(): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    log(`Trying command: ${cmd}`);
    const { stdout } = await execAsync(cmd, {
      env: { ...process.env },
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    });
    // `where` prints every match with CRLF line endings
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (process.platform === "win32") {
      const hasExecutableExt = (p: string) => WINDOWS_EXECUTABLE_EXTENSIONS.includes(path.extname(p).toLowerCase());
      candidates.sort((a, b) => Number(hasExecutableExt(b)) - Number(hasExecutableExt(a)));
    }
    for (const candidate of candidates) {
      const foundPath = await toWindowsExecutable(candidate);
      if (await fileExists(foundPath)) {
        log(`Found CLI via ${cmd}: ${foundPath}`);
        return foundPath;
      }
    }
  } catch (err) {
    log(`which/where command failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

async function findCliViaShellProfile(): Promise<string | null> {
  if (process.platform === "win32") return null;

  try {
    log("Trying shell profile sourcing...");
    const { stdout } = await execAsync(
      "source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null || true; which claude",
      {
        shell: "/bin/bash",
      }
    );
    const foundPath = stdout.trim();
    if (foundPath && (await fileExists(foundPath))) {
      log(`Found CLI via shell profile: ${foundPath}`);
      return foundPath;
    }
  } catch (err) {
    log(`Shell profile sourcing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

async function findCliInCommonPaths(): Promise<string | null> {
  log("Checking common installation paths...");
  for (const p of getCommonCliPaths()) {
    const found = await findCliWithGlob(p);
    if (found) {
      log(`Found CLI at common path: ${found}`);
      return found;
    }
  }
  return null;
}

const DETECTORS: Record<DetectionSource, () => Promise<string | null>> = {
  path: findCliOnPath,
  vscodeExtension: findCliInVscodeExtensions,
  shellProfile: findCliViaShellProfile,
  commonPaths: findCliInCommonPaths,
};

export async function findClaudeCliPath(): Promise<string | null> {
  // 1. Check user settings
  const config = vscode.workspace.getConfiguration("claudeCommit");
  const userPath = config.get<string>("cliPath");

  if (userPath?.trim()) {
    log(`Checking user-configured CLI path: ${userPath}`);
    const resolvedUserPath = await toWindowsExecutable(userPath.trim());
    if (await fileExists(resolvedUserPath)) {
      log(`Found CLI at user-configured path: ${resolvedUserPath}`);
      return resolvedUserPath;
    }
    throw new Error(`Configured CLI path not found: ${userPath}`);
  }

  // 2. Check cache
  if (cachedCliPath && (await fileExists(cachedCliPath))) {
    log(`Using cached CLI path: ${cachedCliPath}`);
    return cachedCliPath;
  }

  // 3. Run the detection sources in the user-configured order
  const order = getDetectionOrder(config);
  log(`Searching for Claude CLI (order: ${order.join(" > ")})...`);

  for (const source of order) {
    const found = await DETECTORS[source]();
    if (found) {
      cachedCliPath = found;
      return found;
    }
  }

  log("Claude CLI not found in any location");
  return null;
}

// Exposed so callers can force a re-detection after settings change
export function clearCliPathCache(): void {
  cachedCliPath = null;
}

export async function hasClaudeCodeCLI(): Promise<boolean> {
  try {
    const cliPath = await findClaudeCliPath();
    return cliPath !== null;
  } catch {
    return false;
  }
}

export async function promptForCliPath(): Promise<string | null> {
  const result = await vscode.window.showWarningMessage(
    "Claude Code CLI not found. Would you like to configure the path manually?",
    "Browse for CLI",
    "Enter Path Manually",
    "Skip (Use API)"
  );

  if (result === "Browse for CLI") {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select Claude CLI Executable",
      filters: process.platform === "win32" ? { Executable: ["exe", "cmd", "bat"] } : undefined,
    });

    if (fileUri?.[0]) {
      const selectedPath = fileUri[0].fsPath;
      await saveCliPath(selectedPath);
      return selectedPath;
    }
  } else if (result === "Enter Path Manually") {
    const manualPath = await vscode.window.showInputBox({
      prompt: "Enter the full path to Claude CLI executable",
      placeHolder: process.platform === "win32" ? "C:\\path\\to\\claude.cmd" : "/usr/local/bin/claude",
      validateInput: async (value) => {
        if (!value) return "Path cannot be empty";
        if (!(await fileExists(value))) {
          return `File not found or not executable: ${value}`;
        }
        return null;
      },
    });

    if (manualPath) {
      await saveCliPath(manualPath);
      return manualPath;
    }
  }

  return null;
}

export async function saveCliPath(cliPath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("claudeCommit");
  await config.update("cliPath", cliPath, vscode.ConfigurationTarget.Global);
  cachedCliPath = cliPath;
  vscode.window.showInformationMessage(`Claude CLI path saved: ${cliPath}`);
}
