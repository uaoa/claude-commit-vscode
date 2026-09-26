import * as vscode from "vscode";
import type { GitRepository, Language, ProgressCallback, GenerationMethod, DiffSource, CommitTense } from "../types";
import { getDiff } from "../utils/git";
import { createGenerationPrompt, createEditPrompt, createManagedPrompt } from "../prompts/generation";
import { hasClaudeCodeCLI, promptForCliPath } from "../cli/detection";
import { generateWithCLI, generateWithCLIManaged, generateWithAPI } from "../cli/execution";
import { getApiKey } from "../utils/apiKey";
import { isCancellation } from "../utils/cancel";
import { log } from "../utils/logger";

// Adds context to a failure but lets a user cancellation through untouched
function withPrefix(prefix: string, error: unknown): Error {
  if (isCancellation(error)) {
    return error as Error;
  }
  return new Error(`${prefix}: ${(error as Error).message}`);
}

export async function generateCommitMessage(
  repo: GitRepository,
  language: Language = "en",
  progressCallback: ProgressCallback | null = null,
  customPrompt: string = "",
  signal?: AbortSignal
): Promise<string> {
  const repoPath = repo.rootUri.fsPath;
  const config = vscode.workspace.getConfiguration("claudeCommit");

  const preferredMethod = config.get<GenerationMethod>("preferredMethod", "auto");

  // Claude Code managed mode: minimal prompt, let Claude Code handle everything
  // Only effective when preferredMethod is "cli"
  const claudeCodeManaged = config.get<boolean>("claudeCodeManaged", false);

  if (claudeCodeManaged && preferredMethod === "cli") {
    if (progressCallback) {
      progressCallback("Getting git diff...");
    }

    if (!(await hasClaudeCodeCLI())) {
      throw new Error("Claude Code managed mode requires Claude Code CLI. Please install it or disable managed mode.");
    }

    const diffSource = config.get<DiffSource>("diffSource", "auto");
    const { diff, stats } = await getDiff(repoPath, diffSource);

    if (!diff && !stats) {
      throw new Error("No changes found. Stage some files first.");
    }

    const keepCoAuthoredBy = config.get<boolean>("keepCoAuthoredBy", false);
    const multiLine = config.get<boolean>("multiLineCommit", false);
    const commitTense = config.get<CommitTense>("commitTense", "imperative");
    const { systemPrompt, userPrompt } = createManagedPrompt(
      language,
      diff,
      stats,
      keepCoAuthoredBy,
      multiLine,
      customPrompt,
      commitTense
    );
    return await generateWithCLIManaged(userPrompt, systemPrompt, progressCallback, signal);
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
  const commitStyle = config.get<string>("commitStyle", "conventional");
  const customTemplate = config.get<string>("customPromptTemplate", "");
  const commitTense = config.get<CommitTense>("commitTense", "imperative");

  const prompt = createGenerationPrompt(diff, stats, language, multiLine, commitStyle, customTemplate, commitTense);

  let commitMessage: string | undefined;
  let cliNotFound = false;

  if (preferredMethod === "cli" || preferredMethod === "auto") {
    if (await hasClaudeCodeCLI()) {
      try {
        if (progressCallback) {
          progressCallback("Generating with Claude CLI...");
        }
        commitMessage = await generateWithCLI(prompt, progressCallback, signal);
        return commitMessage;
      } catch (error) {
        // Without an API key there is nothing to fall back to — surface the real
        // CLI failure instead of a misleading "ANTHROPIC_API_KEY not found".
        if (preferredMethod === "cli" || isCancellation(error) || !(await getApiKey())) {
          throw withPrefix("Claude CLI error", error);
        }
        log(`CLI failed, falling back to API: ${(error as Error).message}`);
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
            commitMessage = await generateWithCLI(prompt, progressCallback, signal);
            return commitMessage;
          } catch (error) {
            throw withPrefix("Claude CLI error", error);
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
    const apiKey = await getApiKey();

    if (!apiKey && cliNotFound) {
      const userPath = await promptForCliPath();
      if (userPath) {
        try {
          if (progressCallback) {
            progressCallback("Generating with Claude CLI...");
          }
          commitMessage = await generateWithCLI(prompt, progressCallback, signal);
          return commitMessage;
        } catch (error) {
          throw withPrefix("Claude CLI error", error);
        }
      }
    }

    try {
      if (progressCallback) {
        progressCallback("Generating with Anthropic API...");
      }
      commitMessage = await generateWithAPI(prompt, progressCallback, signal);
      return commitMessage;
    } catch (error) {
      const err = error as Error;
      if (cliNotFound && err.message.includes("ANTHROPIC_API_KEY")) {
        throw new Error(
          "Claude CLI not found and no API key configured. Either configure CLI path in settings or run 'Claude Commit: Set Anthropic API Key'."
        );
      }
      throw withPrefix("API error", error);
    }
  }

  throw new Error("No generation method available. Install Claude Code CLI or set API key.");
}

export async function editCommitMessage(
  repo: GitRepository,
  currentMessage: string,
  userFeedback: string,
  language: Language = "en",
  progressCallback: ProgressCallback | null = null,
  signal?: AbortSignal
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

  const prompt = createEditPrompt(currentMessage, userFeedback, diff, stats, language);

  const preferredMethod = config.get<GenerationMethod>("preferredMethod", "auto");

  if (preferredMethod === "cli" || preferredMethod === "auto") {
    if (await hasClaudeCodeCLI()) {
      try {
        return await generateWithCLI(prompt, progressCallback, signal);
      } catch (error) {
        // Same fallback as generateCommitMessage: only when an API key exists
        if (preferredMethod === "cli" || isCancellation(error) || !(await getApiKey())) {
          throw error;
        }
        log(`CLI failed, falling back to API: ${(error as Error).message}`);
      }
    }
  }

  if (preferredMethod === "api" || preferredMethod === "auto") {
    return await generateWithAPI(prompt, progressCallback, signal);
  }

  throw new Error("No generation method available");
}
