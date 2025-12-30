import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

// Cache for found CLI path
let cachedCliPath: string | null = null;

function getCommonCliPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [];

  if (process.platform === "win32") {
    paths.push(
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
    return false;
  }
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


export async function findClaudeCliPath(): Promise<string | null> {
  // 1. Check user settings
  const config = vscode.workspace.getConfiguration("claudeCommit");
  const userPath = config.get<string>("cliPath");

  if (userPath && userPath.trim()) {
    if (await fileExists(userPath)) {
      return userPath;
    }
    throw new Error(`Configured CLI path not found: ${userPath}`);
  }

  // 2. Check cache
  if (cachedCliPath && (await fileExists(cachedCliPath))) {
    return cachedCliPath;
  }

  // 3. Try which/where
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    const { stdout } = await execAsync(cmd, {
      env: { ...process.env },
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    });
    const foundPath = stdout.trim().split("\n")[0];
    if (foundPath && (await fileExists(foundPath))) {
      cachedCliPath = foundPath;
      return foundPath;
    }
  } catch {
    // which/where not found
  }

  // 4. Try shell profile
  if (process.platform !== "win32") {
    try {
      const { stdout } = await execAsync(
        "source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null || true; which claude",
        {
          shell: "/bin/bash",
        }
      );
      const foundPath = stdout.trim();
      if (foundPath && (await fileExists(foundPath))) {
        cachedCliPath = foundPath;
        return foundPath;
      }
    } catch {
      // Failed
    }
  }

  // 5. Check common paths
  const commonPaths = getCommonCliPaths();
  for (const p of commonPaths) {
    const found = await findCliWithGlob(p);
    if (found) {
      cachedCliPath = found;
      return found;
    }
  }

  return null;
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
      filters:
        process.platform === "win32"
          ? { Executable: ["exe", "cmd", "bat"] }
          : undefined,
    });

    if (fileUri && fileUri[0]) {
      const selectedPath = fileUri[0].fsPath;
      await saveCliPath(selectedPath);
      return selectedPath;
    }
  } else if (result === "Enter Path Manually") {
    const manualPath = await vscode.window.showInputBox({
      prompt: "Enter the full path to Claude CLI executable",
      placeHolder:
        process.platform === "win32"
          ? "C:\\path\\to\\claude.cmd"
          : "/usr/local/bin/claude",
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
