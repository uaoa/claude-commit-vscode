import * as vscode from "vscode";
import { generateCommitMessage, editCommitMessage } from "./generators/commit";
import type { GitRepository, GitAPI, Language } from "./types";
import { log, logError, showOutputChannel, disposeOutputChannel } from "./utils/logger";
import { clearCliPathCache } from "./cli/detection";
import { setGitPath } from "./utils/git";
import { isInsideFolder } from "./utils/paths";
import { initApiKeyStorage, setApiKeyCommand, suggestApiKeyMigration } from "./utils/apiKey";
import { isCancellation } from "./utils/cancel";
import { migrateLegacySettings } from "./utils/legacySettings";

// Guards against a second click starting a parallel generation for the same message box
let isGenerating = false;

// Bridges the progress notification's Cancel button to the CLI process / API request
function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

/**
 * Show the success notification according to the user's settings.
 * Resolves with the clicked button, or undefined when the message is disabled or dismissed.
 */
async function showSuccessMessage(message: string, ...buttons: string[]): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("commitPen");
  if (!config.get<boolean>("showSuccessMessage", true)) {
    return undefined;
  }

  const timeoutSeconds = config.get<number>("messageAutoCloseSeconds", 5);
  if (timeoutSeconds <= 0) {
    return vscode.window.showInformationMessage(message, ...buttons);
  }

  // VS Code has no API to close a notification, so once the timeout passes the
  // toast is hidden into the Notification Center; its buttons keep working there.
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) {
      void vscode.commands.executeCommand("notifications.hideToasts");
    }
  }, timeoutSeconds * 1000);

  try {
    return await vscode.window.showInformationMessage(message, ...buttons);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

/**
 * Get the Git repository from a SourceControl object passed by VS Code
 * when a command is triggered from the SCM title menu.
 */
function getRepositoryFromSourceControl(
  git: GitAPI,
  sourceControl: vscode.SourceControl | undefined
): GitRepository | undefined {
  if (!sourceControl || git.repositories.length === 0) {
    return undefined;
  }

  // Match by rootUri - the SourceControl's rootUri should match the repository's rootUri
  const scmRootUri = sourceControl.rootUri;
  if (scmRootUri) {
    for (const repo of git.repositories) {
      if (repo.rootUri.fsPath === scmRootUri.fsPath) {
        return repo;
      }
    }
  }

  return undefined;
}

/**
 * Get the currently active Git repository based on:
 * 1. SourceControl parameter from SCM menu (if provided)
 * 2. The repository containing the currently active editor's file
 * 3. Falls back to the first repository if neither is available
 */
function getActiveRepository(git: GitAPI, sourceControl?: vscode.SourceControl): GitRepository | undefined {
  if (git.repositories.length === 0) {
    return undefined;
  }

  // First priority: repository from SourceControl parameter (when triggered from SCM menu)
  if (sourceControl) {
    const repoFromSC = getRepositoryFromSourceControl(git, sourceControl);
    if (repoFromSC) {
      return repoFromSC;
    }
  }

  if (git.repositories.length === 1) {
    return git.repositories[0];
  }

  // Try to find repository based on currently active editor
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const activeFilePath = activeEditor.document.uri.fsPath;
    // Deepest match wins so a nested repo/submodule beats its parent;
    // path.relative avoids "/repo" matching "/repo-other/file".
    const match = git.repositories
      .filter((repo) => isInsideFolder(activeFilePath, repo.rootUri.fsPath))
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
    if (match) {
      return match;
    }
  }

  // Fallback to first repository
  return git.repositories[0];
}

export function activate(context: vscode.ExtensionContext): void {
  log("Commit Pen extension activated");
  initApiKeyStorage(context);
  migrateLegacySettings(context).catch((error) => logError("Legacy settings migration failed", error));

  const generateCommit = vscode.commands.registerCommand(
    "commit-pen.generate",
    async (sourceControl?: vscode.SourceControl) => {
      try {
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
          vscode.window.showErrorMessage("Git extension not found");
          return;
        }

        const git = gitExtension.exports.getAPI(1) as GitAPI;
        setGitPath(git.git?.path);
        if (git.repositories.length === 0) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        const repo = getActiveRepository(git, sourceControl);
        if (!repo) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        const config = vscode.workspace.getConfiguration("commitPen");
        const claudeCodeManaged = config.get<boolean>("claudeCodeManaged", false);
        const preferredMethod = config.get<string>("preferredMethod", "auto");

        if (repo.state.indexChanges.length === 0 && repo.state.workingTreeChanges.length === 0) {
          vscode.window.showWarningMessage("No changes to commit. Stage files first.");
          return;
        }

        if (isGenerating) {
          vscode.window.showInformationMessage("Commit message generation is already in progress.");
          return;
        }
        isGenerating = true;

        let commitMessage: string | null = null;
        let generationError: unknown = null;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Commit Pen",
            cancellable: true,
          },
          async (progress, token) => {
            try {
              const config = vscode.workspace.getConfiguration("commitPen");
              const language = config.get<Language>("language", "en");

              const updateProgress = (message: string): void => {
                progress.report({ message });
              };

              commitMessage = await generateCommitMessage(repo, language, updateProgress, "", toAbortSignal(token));
            } catch (error) {
              generationError = error as Error;
            } finally {
              isGenerating = false;
            }
          }
        );

        if (isCancellation(generationError)) {
          log("Generation cancelled by user");
          return;
        }

        if (generationError) {
          const errorMessage = generationError instanceof Error ? generationError.message : String(generationError);
          logError("Failed to generate commit", generationError);
          const action = await vscode.window.showErrorMessage(
            `Failed to generate commit: ${errorMessage}`,
            "Show Logs"
          );
          if (action === "Show Logs") {
            showOutputChannel();
          }
          return;
        }

        if (commitMessage) {
          repo.inputBox.value = commitMessage;

          // Show different buttons based on mode
          const isManagedMode = claudeCodeManaged && preferredMethod === "cli";

          const buttons = isManagedMode ? ["Custom prompt"] : ["Edit with feedback"];

          const action = await showSuccessMessage("Commit message generated!", ...buttons);

          if (action === "Edit with feedback") {
            await handleEditWithFeedback(repo, commitMessage);
          } else if (action === "Custom prompt") {
            await handleCustomPrompt(repo);
          }
        }
      } catch (error) {
        const err = error as Error;
        vscode.window.showErrorMessage(`Error: ${err.message}`);
      }
    }
  );

  const generateCommitWithCustomPrompt = vscode.commands.registerCommand(
    "commit-pen.generateWithCustomPrompt",
    async (sourceControl?: vscode.SourceControl) => {
      try {
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
          vscode.window.showErrorMessage("Git extension not found");
          return;
        }

        const git = gitExtension.exports.getAPI(1) as GitAPI;
        setGitPath(git.git?.path);
        if (git.repositories.length === 0) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        const repo = getActiveRepository(git, sourceControl);
        if (!repo) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        // This command only works in managed mode
        const config = vscode.workspace.getConfiguration("commitPen");
        const claudeCodeManaged = config.get<boolean>("claudeCodeManaged", false);
        const preferredMethod = config.get<string>("preferredMethod", "auto");

        if (!(claudeCodeManaged && preferredMethod === "cli")) {
          vscode.window.showWarningMessage(
            "Custom prompt is only available in Claude Code managed mode. Enable 'claudeCodeManaged' and set 'preferredMethod' to 'cli'."
          );
          return;
        }

        await handleCustomPrompt(repo);
      } catch (error) {
        const err = error as Error;
        vscode.window.showErrorMessage(`Error: ${err.message}`);
      }
    }
  );

  // Re-run detection when the user changes how the CLI should be located
  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("commitPen.detectionOrder") || event.affectsConfiguration("commitPen.cliPath")) {
      log("CLI detection settings changed, clearing cached CLI path");
      clearCliPathCache();
    }
  });

  const setApiKey = vscode.commands.registerCommand("commit-pen.setApiKey", setApiKeyCommand);

  context.subscriptions.push(generateCommit, generateCommitWithCustomPrompt, setApiKey, configWatcher);

  // Non-blocking, shown at most once per machine
  void suggestApiKeyMigration(context);
}

async function handleCustomPrompt(repo: GitRepository): Promise<void> {
  const customPrompt = await vscode.window.showInputBox({
    prompt: "Enter custom prompt to guide commit message generation",
    placeHolder: "e.g., 'Focus on the API changes', 'Use conventional commits format', 'Be more concise'",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Please provide a custom prompt";
      }
      return null;
    },
  });

  if (!customPrompt) {
    return;
  }

  // The follow-up prompt runs after withProgress resolves, otherwise the
  // progress notification keeps spinning while the user types.
  const newMessage = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Commit Pen",
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const config = vscode.workspace.getConfiguration("commitPen");
        const language = config.get<Language>("language", "en");

        const updateProgress = (message: string): void => {
          progress.report({ message });
        };

        return await generateCommitMessage(repo, language, updateProgress, customPrompt, toAbortSignal(token));
      } catch (error) {
        const err = error as Error;
        if (isCancellation(error)) {
          return undefined;
        }
        vscode.window.showErrorMessage(`Failed to regenerate: ${err.message}`);
        return undefined;
      }
    }
  );

  if (!newMessage) {
    return;
  }

  repo.inputBox.value = newMessage;

  const action = await showSuccessMessage("Commit message regenerated!", "Custom prompt", "OK");

  if (action === "Custom prompt") {
    await handleCustomPrompt(repo);
  }
}

async function handleEditWithFeedback(repo: GitRepository, currentMessage: string): Promise<void> {
  const feedback = await vscode.window.showInputBox({
    prompt: "Enter your feedback to improve the commit message",
    placeHolder: "e.g., 'Make it shorter', 'Focus on the API changes', 'Add breaking change note'",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Please provide some feedback";
      }
      return null;
    },
  });

  if (!feedback) {
    return;
  }

  const newMessage = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Commit Pen",
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const config = vscode.workspace.getConfiguration("commitPen");
        const language = config.get<Language>("language", "en");

        const updateProgress = (message: string): void => {
          progress.report({ message });
        };

        return await editCommitMessage(repo, currentMessage, feedback, language, updateProgress, toAbortSignal(token));
      } catch (error) {
        const err = error as Error;
        if (isCancellation(error)) {
          return undefined;
        }
        vscode.window.showErrorMessage(`Failed to regenerate: ${err.message}`);
        return undefined;
      }
    }
  );

  if (!newMessage) {
    return;
  }

  repo.inputBox.value = newMessage;

  const action = await showSuccessMessage("Commit message regenerated!", "Edit again", "OK");

  if (action === "Edit again") {
    await handleEditWithFeedback(repo, newMessage);
  }
}

export function deactivate(): void {
  disposeOutputChannel();
}
