import * as vscode from "vscode";
import { generateCommitMessage, editCommitMessage, generateWithCustomPrompt } from "./generators/commit";
import type { GitRepository, Language } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  console.log("Claude Commit extension is now active");

  const generateCommit = vscode.commands.registerCommand(
    "claude-commit.generate",
    async () => {
      try {
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
          vscode.window.showErrorMessage("Git extension not found");
          return;
        }

        const git = gitExtension.exports.getAPI(1);
        if (git.repositories.length === 0) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        const repo = git.repositories[0] as GitRepository;

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

          const action = isManagedMode
            ? await vscode.window.showInformationMessage(
                "Commit message generated!",
                "Custom prompt",
                "OK"
              )
            : await vscode.window.showInformationMessage(
                "Commit message generated!",
                "Edit with feedback",
                "OK"
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
    async () => {
      try {
        const gitExtension = vscode.extensions.getExtension("vscode.git");
        if (!gitExtension) {
          vscode.window.showErrorMessage("Git extension not found");
          return;
        }

        const git = gitExtension.exports.getAPI(1);
        if (git.repositories.length === 0) {
          vscode.window.showErrorMessage("No Git repository found");
          return;
        }

        const repo = git.repositories[0] as GitRepository;

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

        const newMessage = await generateWithCustomPrompt(
          repo,
          customPrompt,
          language,
          updateProgress
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
