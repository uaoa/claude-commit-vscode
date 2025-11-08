const vscode = require('vscode');
const { generateCommitMessage } = require('./commit-generator');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Claude Commit extension is now active');

    // Реєструємо команду для генерації коміту
    let generateCommit = vscode.commands.registerCommand('claude-commit.generate', async () => {
        try {
            // Отримуємо git extension
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                vscode.window.showErrorMessage('Git extension not found');
                return;
            }

            const git = gitExtension.exports.getAPI(1);
            if (git.repositories.length === 0) {
                vscode.window.showErrorMessage('No Git repository found');
                return;
            }

            const repo = git.repositories[0];

            // Перевіряємо staged changes
            if (repo.state.indexChanges.length === 0 && repo.state.workingTreeChanges.length === 0) {
                vscode.window.showWarningMessage('No changes to commit. Stage files first.');
                return;
            }

            // Показуємо індикатор прогресу
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Generating commit message...",
                cancellable: false
            }, async (progress) => {
                try {
                    // Отримуємо конфігурацію
                    const config = vscode.workspace.getConfiguration('claudeCommit');
                    const language = config.get('language', 'en');

                    // Генеруємо commit message
                    const commitMessage = await generateCommitMessage(repo, language);

                    if (commitMessage) {
                        // Встановлюємо згенерований message в input box
                        repo.inputBox.value = commitMessage;
                        vscode.window.showInformationMessage('Commit message generated!');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to generate commit: ${error.message}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    });

    context.subscriptions.push(generateCommit);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
