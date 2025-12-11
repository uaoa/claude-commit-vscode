import * as vscode from "vscode";
import { generateCommitMessage, editCommitMessage } from "./generators/commit";
import type { GitRepository, GitAPI, Language } from "./types";

/**
 * Show an information message that auto-closes after a specified timeout.
 * Returns the selected button or undefined if auto-closed/dismissed.
 */
function showAutoCloseMessage(
  message: string,
  timeoutSeconds: number,
  ...buttons: string[]
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let resolved = false;

    const resolveOnce = (result: string | undefined) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    // Auto-close timer
    const timer = setTimeout(() => {
      resolveOnce(undefined);
    }, timeoutSeconds * 1000);

    // Show message with countdown hint in text
    const messageWithHint = `${message} (${timeoutSeconds}s)`;
    vscode.window
      .showInformationMessage(messageWithHint, ...buttons)
      .then((result) => {
        clearTimeout(timer);
        resolveOnce(result);
      });
  });
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
function getActiveRepository(
  git: GitAPI,
  sourceControl?: vscode.SourceControl
): GitRepository | undefined {
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
    for (const repo of git.repositories) {
      const repoPath = repo.rootUri.fsPath;
      if (activeFilePath.startsWith(repoPath)) {
        return repo;
      }
    }
  }

  // Fallback to first repository
  return git.repositories[0];
}

export function activate(context: vscode.ExtensionContext): void {
  console.log("Claude Commit extension is now active");

  const generateCommit = vscode.commands.registerCommand(
    "claude-commit.generate",
    async (sourceControl?: vscode.SourceControl) => {
      try {
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
          vscode.window.showErrorMessage("Git extension not found");
          return;
        }

        const git = gitExtension.exports.getAPI(1) as GitAPI;
        if (git.repositories.length === 0) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        const repo = getActiveRepository(git, sourceControl);
        if (!repo) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        // Skip change check in Claude Code managed mode (Claude Code will detect changes itself)
        const config = vscode.workspace.getConfiguration("claudeCommit");
        const claudeCodeManaged = config.get<boolean>("claudeCodeManaged", false);
        const preferredMethod = config.get<string>("preferredMethod", "auto");

        if (!(claudeCodeManaged && preferredMethod === "cli")) {
          if (
            repo.state.indexChanges.length === 0 &&
            repo.state.workingTreeChanges.length === 0
          ) {
            vscode.window.showWarningMessage(
              "No changes to commit. Stage files first."
            );
            return;
          }
        }

        let commitMessage: string | null = null;
        let generationError: unknown = null;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Claude Commit",
            cancellable: false,
          },
          async (progress) => {
            try {
              const config =
                vscode.workspace.getConfiguration("claudeCommit");
              const language = config.get<Language>("language", "en");

              const updateProgress = (message: string): void => {
                progress.report({ message });
              };

              commitMessage = await generateCommitMessage(
                repo,
                language,
                updateProgress
              );
            } catch (error) {
              generationError = error as Error;
            }
          }
        );

        if (generationError) {
          const errorMessage = generationError instanceof Error
            ? generationError.message
            : String(generationError);
          vscode.window.showErrorMessage(
            `Failed to generate commit: ${errorMessage}`
          );
          return;
        }

        if (commitMessage) {
          repo.inputBox.value = commitMessage;

          // Show different buttons based on mode
          const isManagedMode = claudeCodeManaged && preferredMethod === "cli";

          const buttons = isManagedMode
            ? ["Custom prompt"]
            : ["Edit with feedback"];

          // Get auto-close timeout from config
          const autoCloseSeconds = config.get<number>("messageAutoCloseSeconds", 5);

          // Show message with auto-close (or without if set to 0)
          const action = autoCloseSeconds > 0
            ? await showAutoCloseMessage(
                "Commit message generated!",
                autoCloseSeconds,
                ...buttons
              )
            : await vscode.window.showInformationMessage(
                "Commit message generated!",
                ...buttons
              );

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
    "claude-commit.generateWithCustomPrompt",
    async (sourceControl?: vscode.SourceControl) => {
      try {
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
          vscode.window.showErrorMessage("Git extension not found");
          return;
        }

        const git = gitExtension.exports.getAPI(1) as GitAPI;
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
        const config = vscode.workspace.getConfiguration("claudeCommit");
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

  context.subscriptions.push(generateCommit, generateCommitWithCustomPrompt);
}

async function handleCustomPrompt(repo: GitRepository): Promise<void> {
  const customPrompt = await vscode.window.showInputBox({
    prompt: "Enter custom prompt to guide commit message generation",
    placeHolder:
      "e.g., 'Focus on the API changes', 'Use conventional commits format', 'Be more concise'",
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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Claude Commit",
      cancellable: false,
    },
    async (progress) => {
      try {
        const config = vscode.workspace.getConfiguration("claudeCommit");
        const language = config.get<Language>("language", "en");

        const updateProgress = (message: string): void => {
          progress.report({ message });
        };

        const newMessage = await generateCommitMessage(
          repo,
          language,
          updateProgress,
          customPrompt
        );

        if (newMessage) {
          repo.inputBox.value = newMessage;

          // Show message with 5 second auto-dismiss
          const messagePromise = vscode.window.showInformationMessage(
            "Commit message regenerated!",
            "Custom prompt",
            "OK"
          );
          const timeoutPromise = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000));

          const action = await Promise.race([messagePromise, timeoutPromise]);

          if (action === "Custom prompt") {
            await handleCustomPrompt(repo);
          }
        }
      } catch (error) {
        const err = error as Error;
        vscode.window.showErrorMessage(
          `Failed to regenerate: ${err.message}`
        );
      }
    }
  );
}

async function handleEditWithFeedback(
  repo: GitRepository,
  currentMessage: string
): Promise<void> {
  const feedback = await vscode.window.showInputBox({
    prompt: "Enter your feedback to improve the commit message",
    placeHolder:
      "e.g., 'Make it shorter', 'Focus on the API changes', 'Add breaking change note'",
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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Claude Commit",
      cancellable: false,
    },
    async (progress) => {
      try {
        const config = vscode.workspace.getConfiguration("claudeCommit");
        const language = config.get<Language>("language", "en");

        const updateProgress = (message: string): void => {
          progress.report({ message });
        };

        const newMessage = await editCommitMessage(
          repo,
          currentMessage,
          feedback,
          language,
          updateProgress
        );

        if (newMessage) {
          repo.inputBox.value = newMessage;

          const action = await vscode.window.showInformationMessage(
            "Commit message regenerated!",
            "Edit again",
            "OK"
          );

          if (action === "Edit again") {
            await handleEditWithFeedback(repo, newMessage);
          }
        }
      } catch (error) {
        const err = error as Error;
        vscode.window.showErrorMessage(
          `Failed to regenerate: ${err.message}`
        );
      }
    }
  );
}

export function deactivate(): void {}
