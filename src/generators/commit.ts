import * as vscode from "vscode";
import {
  GitRepository,
  Language,
  ProgressCallback,
  GenerationMethod,
  DiffSource,
} from "../types";
import { getDiff } from "../utils/git";
import { createGenerationPrompt, createEditPrompt, createManagedPrompt } from "../prompts/generation";
import {
  hasClaudeCodeCLI,
  promptForCliPath,
} from "../cli/detection";
import { generateWithCLI, generateWithCLIManaged, generateWithAPI } from "../cli/execution";

export async function generateCommitMessage(
  repo: GitRepository,
  language: Language = "en",
  progressCallback: ProgressCallback | null = null,
  customPrompt: string = ""
): Promise<string> {
  const repoPath = repo.rootUri.fsPath;
  const config = vscode.workspace.getConfiguration("claudeCommit");

  const preferredMethod = config.get<GenerationMethod>("preferredMethod", "auto");

  // Claude Code managed mode: minimal prompt, let Claude Code handle everything
  // Only effective when preferredMethod is "cli"
  const claudeCodeManaged = config.get<boolean>("claudeCodeManaged", false);

  if (claudeCodeManaged && preferredMethod === "cli") {
    if (progressCallback) {
      progressCallback("Claude Code managed mode...");
    }

    if (!(await hasClaudeCodeCLI())) {
      throw new Error(
        "Claude Code managed mode requires Claude Code CLI. Please install it or disable managed mode."
      );
    }

    const keepCoAuthoredBy = config.get<boolean>("keepCoAuthoredBy", false);
    const multiLine = config.get<boolean>("multiLineCommit", false);
    const diffSource = config.get<DiffSource>("diffSource", "auto");
    const prompt = createManagedPrompt(language, keepCoAuthoredBy, multiLine, diffSource, customPrompt);
    return await generateWithCLIManaged(prompt, repoPath, progressCallback);
  }

  if (progressCallback) {
    progressCallback("Getting git diff...");
  }

  const diffSource = config.get<DiffSource>("diffSource", "auto");

  const { diff, stats } = await getDiff(repoPath, diffSource);

  if (!diff && !stats) {
    throw new Error("No changes found. Stage some files first.");
  }

  if (progressCallback) {
    progressCallback("Preparing prompt...");
  }

  const multiLine = config.get<boolean>("multiLineCommit", false);

  const prompt = createGenerationPrompt(diff, stats, language, multiLine);

  let commitMessage: string | undefined;
  let cliNotFound = false;

  if (preferredMethod === "cli" || preferredMethod === "auto") {
    if (await hasClaudeCodeCLI()) {
      try {
        if (progressCallback) {
          progressCallback("Generating with Claude CLI...");
        }
        commitMessage = await generateWithCLI(prompt, progressCallback);
        return commitMessage;
      } catch (error) {
        const err = error as Error;
        if (preferredMethod === "cli") {
          throw new Error(`Claude CLI error: ${err.message}`);
        }
        console.warn(`CLI failed, trying API: ${err.message}`);
      }
    } else {
      cliNotFound = true;
      if (preferredMethod === "cli") {
        const userPath = await promptForCliPath();
        if (userPath) {
          try {
            if (progressCallback) {
              progressCallback("Generating with Claude CLI...");
            }
            commitMessage = await generateWithCLI(prompt, progressCallback);
            return commitMessage;
          } catch (error) {
            const err = error as Error;
            throw new Error(`Claude CLI error: ${err.message}`);
          }
        } else {
          throw new Error(
            'Claude CLI not found and no path configured. Run "which claude" in terminal to find the path.'
          );
        }
      }
    }
  }

  if (preferredMethod === "api" || preferredMethod === "auto") {
    const apiKey = config.get<string>("apiKey") || process.env.ANTHROPIC_API_KEY;

    if (!apiKey && cliNotFound) {
      const userPath = await promptForCliPath();
      if (userPath) {
        try {
          if (progressCallback) {
            progressCallback("Generating with Claude CLI...");
          }
          commitMessage = await generateWithCLI(prompt, progressCallback);
          return commitMessage;
        } catch (error) {
          const err = error as Error;
          throw new Error(`Claude CLI error: ${err.message}`);
        }
      }
    }

    try {
      if (progressCallback) {
        progressCallback("Generating with Anthropic API...");
      }
      commitMessage = await generateWithAPI(prompt, progressCallback);
      return commitMessage;
    } catch (error) {
      const err = error as Error;
      if (cliNotFound && err.message.includes("ANTHROPIC_API_KEY")) {
        throw new Error(
          "Claude CLI not found and no API key configured. Either configure CLI path in settings or set ANTHROPIC_API_KEY."
        );
      }
      throw new Error(`API error: ${err.message}`);
    }
  }

  throw new Error(
    "No generation method available. Install Claude Code CLI or set API key."
  );
}


export async function editCommitMessage(
  repo: GitRepository,
  currentMessage: string,
  userFeedback: string,
  language: Language = "en",
  progressCallback: ProgressCallback | null = null
): Promise<string> {
  const repoPath = repo.rootUri.fsPath;

  if (progressCallback) {
    progressCallback("Getting git diff...");
  }

  const config = vscode.workspace.getConfiguration("claudeCommit");
  const diffSource = config.get<DiffSource>("diffSource", "auto");

  const { diff, stats } = await getDiff(repoPath, diffSource);

  if (progressCallback) {
    progressCallback("Regenerating based on feedback...");
  }

  const prompt = createEditPrompt(
    currentMessage,
    userFeedback,
    diff,
    stats,
    language
  );

  const preferredMethod = config.get<GenerationMethod>("preferredMethod", "auto");

  if (preferredMethod === "cli" || preferredMethod === "auto") {
    if (await hasClaudeCodeCLI()) {
      return await generateWithCLI(prompt, progressCallback);
    }
  }

  if (preferredMethod === "api" || preferredMethod === "auto") {
    return await generateWithAPI(prompt, progressCallback);
  }

  throw new Error("No generation method available");
}
