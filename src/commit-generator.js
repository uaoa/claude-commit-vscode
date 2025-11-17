const vscode = require("vscode");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const os = require("os");

const execAsync = promisify(exec);

// Кешуємо знайдений шлях до CLI
let cachedCliPath = null;

/**
 * Створення промпту для генерації commit message
 */
function createGenerationPrompt(diff, stats, lang) {
	const isUkrainian = lang === "ua";

	if (isUkrainian) {
		return `Проаналізуй git зміни та згенеруй commit message у форматі conventional commits.

Статистика змін:
${stats}

Diff (перші 6000 символів):
${diff.slice(0, 6000)}

СУВОРІ ПРАВИЛА:
- Формат: <type>(<scope>): <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Subject ТІЛЬКИ у МИНУЛОМУ ЧАСІ (що ЗРОБЛЕНО), макс 50 символів, без крапки
- Використовуй дієслова: додано, виправлено, оновлено, видалено, рефакторено
- НЕПРАВИЛЬНО: "додати функцію", "виправити баг", "оновити стилі"
- ПРАВИЛЬНО: "додано функцію", "виправлено баг", "оновлено стилі"

Приклади:
feat(auth): додано Google OAuth провайдер
fix(api): виправлено помилку валідації в user endpoint
refactor(store): оптимізовано управління станом корзини
docs(readme): оновлено інструкції встановлення

Поверни ТІЛЬКИ commit message (один рядок), без пояснень.`;
	} else {
		return `Analyze git changes and generate commit message in conventional commits format.

Change statistics:
${stats}

Diff (first 6000 characters):
${diff.slice(0, 6000)}

STRICT RULES:
- Format: <type>(<scope>): <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Subject in PAST TENSE (what WAS DONE), max 50 characters, no period
- Use verbs like: added, fixed, updated, removed, refactored
- WRONG: "add feature", "fix bug", "update styles"
- CORRECT: "added feature", "fixed bug", "updated styles"

Examples:
feat(auth): added Google OAuth provider
fix(api): fixed validation error in user endpoint
refactor(store): optimized cart state management
docs(readme): updated installation instructions

Return ONLY the commit message (one line), no explanations.`;
	}
}

/**
 * Отримання diff через git CLI
 */
async function getDiff(repoPath) {
	try {
		const { stdout: diff } = await execAsync("git diff --cached --unified=1", {
			cwd: repoPath,
			maxBuffer: 10 * 1024 * 1024,
		});

		const { stdout: stats } = await execAsync("git diff --cached --stat", {
			cwd: repoPath,
		});

		return { diff: diff || "", stats: stats || "" };
	} catch (error) {
		// Якщо немає staged changes, спробуємо unstaged
		try {
			const { stdout: diff } = await execAsync("git diff --unified=1", {
				cwd: repoPath,
				maxBuffer: 10 * 1024 * 1024,
			});

			const { stdout: stats } = await execAsync("git diff --stat", {
				cwd: repoPath,
			});

			return { diff: diff || "", stats: stats || "" };
		} catch (err) {
			throw new Error("Failed to get git diff");
		}
	}
}

/**
 * Отримання типових шляхів для пошуку Claude CLI
 */
function getCommonCliPaths() {
	const home = os.homedir();
	const paths = [];

	if (process.platform === "win32") {
		// Windows paths
		paths.push(
			path.join(home, "AppData", "Roaming", "npm", "claude.cmd"),
			path.join(home, "AppData", "Local", "npm", "claude.cmd"),
			path.join(home, ".claude", "local", "claude.exe"),
			"C:\\Program Files\\nodejs\\claude.cmd",
			"C:\\Program Files (x86)\\nodejs\\claude.cmd",
		);
	} else {
		// Unix-like paths (macOS, Linux)
		paths.push(
			"/usr/local/bin/claude",
			"/usr/bin/claude",
			"/opt/homebrew/bin/claude",
			path.join(home, ".local", "bin", "claude"),
			path.join(home, ".claude", "local", "claude"),
			path.join(home, ".nvm", "versions", "node", "*", "bin", "claude"),
			path.join(home, ".npm-global", "bin", "claude"),
			path.join(home, "bin", "claude"),
		);
	}

	return paths;
}

/**
 * Перевірка чи існує файл
 */
async function fileExists(filePath) {
	try {
		await fs.promises.access(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Пошук CLI через glob pattern (для NVM)
 */
async function findCliWithGlob(pattern) {
	if (!pattern.includes("*")) {
		return (await fileExists(pattern)) ? pattern : null;
	}

	const parts = pattern.split("*");
	if (parts.length !== 2) return null;

	const baseDir = parts[0].slice(0, -1); // Remove trailing /
	const suffix = parts[1];

	try {
		const entries = await fs.promises.readdir(baseDir);
		for (const entry of entries) {
			const fullPath = path.join(baseDir, entry, suffix.slice(1)); // Remove leading /
			if (await fileExists(fullPath)) {
				return fullPath;
			}
		}
	} catch {
		// Directory doesn't exist
	}
	return null;
}

/**
 * Знайти шлях до Claude CLI
 */
async function findClaudeCliPath() {
	// 1. Перевіряємо налаштування користувача
	const config = vscode.workspace.getConfiguration("claudeCommit");
	const userPath = config.get("cliPath");

	if (userPath && userPath.trim()) {
		if (await fileExists(userPath)) {
			return userPath;
		}
		// Користувач вказав невірний шлях
		throw new Error(`Configured CLI path not found: ${userPath}`);
	}

	// 2. Перевіряємо кеш
	if (cachedCliPath && (await fileExists(cachedCliPath))) {
		return cachedCliPath;
	}

	// 3. Спробуємо which/where
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
		// which/where не знайшов
	}

	// 4. Пробуємо отримати PATH з shell profile
	if (process.platform !== "win32") {
		try {
			const { stdout } = await execAsync(
				"source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null || true; which claude",
				{
					shell: "/bin/bash",
				},
			);
			const foundPath = stdout.trim();
			if (foundPath && (await fileExists(foundPath))) {
				cachedCliPath = foundPath;
				return foundPath;
			}
		} catch {
			// Не вдалося
		}
	}

	// 5. Перевіряємо типові шляхи
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

/**
 * Перевірка наявності Claude Code CLI
 */
async function hasClaudeCodeCLI() {
	const cliPath = await findClaudeCliPath();
	return cliPath !== null;
}

/**
 * Запит у користувача шляху до CLI
 */
async function promptForCliPath() {
	const result = await vscode.window.showWarningMessage(
		"Claude Code CLI not found. Would you like to configure the path manually?",
		"Browse for CLI",
		"Enter Path Manually",
		"Skip (Use API)",
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

/**
 * Зберегти шлях до CLI в налаштуваннях
 */
async function saveCliPath(cliPath) {
	const config = vscode.workspace.getConfiguration("claudeCommit");
	await config.update("cliPath", cliPath, vscode.ConfigurationTarget.Global);
	cachedCliPath = cliPath;
	vscode.window.showInformationMessage(`Claude CLI path saved: ${cliPath}`);
}

/**
 * Генерація через Claude Code CLI
 */
async function generateWithCLI(prompt) {
	const cliPath = await findClaudeCliPath();

	if (!cliPath) {
		throw new Error("Claude CLI path not found");
	}

	// Екрануємо шлях для використання в shell
	const escapedCliPath = cliPath.includes(" ") ? `"${cliPath}"` : cliPath;

	// Використовуємо -p (print) флаг для неінтерактивного режиму
	// Передаємо промпт як аргумент, а не через stdin
	// Екрануємо одинарні лапки в промпті
	const escapedPrompt = prompt.replace(/'/g, "'\\''");

	const command =
		process.platform === "win32"
			? `${escapedCliPath} -p "${prompt.replace(/"/g, '\\"')}"`
			: `${escapedCliPath} -p '${escapedPrompt}'`;

	const { stdout } = await execAsync(command, {
		shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
		maxBuffer: 10 * 1024 * 1024,
		timeout: 60000, // 1 хвилина для генерації
	});

	// Парсимо відповідь - шукаємо conventional commit
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const conventionalCommitPattern =
		/^(feat|fix|docs|style|refactor|test|chore|perf)(\(.+?\))?:.+/;

	for (let i = lines.length - 1; i >= 0; i--) {
		if (conventionalCommitPattern.test(lines[i])) {
			return lines[i];
		}
	}

	return lines[lines.length - 1] || "chore: update code";
}

/**
 * Генерація через Anthropic API
 */
async function generateWithAPI(prompt) {
	const config = vscode.workspace.getConfiguration("claudeCommit");
	const apiKey = config.get("apiKey") || process.env.ANTHROPIC_API_KEY;

	if (!apiKey) {
		throw new Error(
			"ANTHROPIC_API_KEY not found. Set it in extension settings or environment variable.",
		);
	}

	try {
		const Anthropic = require("@anthropic-ai/sdk");
		const anthropic = new Anthropic({ apiKey });

		const message = await anthropic.messages.create({
			model: "claude-sonnet-4-5-20250929",
			max_tokens: 500,
			temperature: 0.3,
			messages: [{ role: "user", content: prompt }],
		});

		return message.content[0].text.trim();
	} catch (error) {
		if (error.code === "MODULE_NOT_FOUND") {
			throw new Error(
				"Install @anthropic-ai/sdk to use API: npm install @anthropic-ai/sdk",
			);
		}
		throw error;
	}
}

/**
 * Головна функція генерації commit message
 */
async function generateCommitMessage(repo, language = "en") {
	const repoPath = repo.rootUri.fsPath;

	// Отримуємо diff
	const { diff, stats } = await getDiff(repoPath);

	if (!diff && !stats) {
		throw new Error("No changes found");
	}

	// Створюємо промпт
	const prompt = createGenerationPrompt(diff, stats, language);

	// Визначаємо метод генерації
	const config = vscode.workspace.getConfiguration("claudeCommit");
	const preferredMethod = config.get("preferredMethod", "auto");

	let commitMessage;
	let cliNotFound = false;

	if (preferredMethod === "cli" || preferredMethod === "auto") {
		// Спробуємо CLI
		if (await hasClaudeCodeCLI()) {
			try {
				commitMessage = await generateWithCLI(prompt);
				return commitMessage;
			} catch (error) {
				if (preferredMethod === "cli") {
					throw new Error(`Claude CLI error: ${error.message}`);
				}
				// Якщо auto, спробуємо API
			}
		} else {
			cliNotFound = true;
			// CLI не знайдено, запитаємо користувача
			if (preferredMethod === "cli") {
				const userPath = await promptForCliPath();
				if (userPath) {
					// Користувач вказав шлях, спробуємо ще раз
					try {
						commitMessage = await generateWithCLI(prompt);
						return commitMessage;
					} catch (error) {
						throw new Error(`Claude CLI error: ${error.message}`);
					}
				} else {
					throw new Error(
						'Claude CLI not found and no path configured. Run "which claude" in terminal to find the path.',
					);
				}
			}
		}
	}

	if (preferredMethod === "api" || preferredMethod === "auto") {
		// Перевіряємо чи є API ключ
		const apiKey = config.get("apiKey") || process.env.ANTHROPIC_API_KEY;

		if (!apiKey && cliNotFound) {
			// Немає ні CLI, ні API ключа - запитаємо шлях до CLI
			const userPath = await promptForCliPath();
			if (userPath) {
				// Користувач вказав шлях, спробуємо CLI
				try {
					commitMessage = await generateWithCLI(prompt);
					return commitMessage;
				} catch (error) {
					throw new Error(`Claude CLI error: ${error.message}`);
				}
			}
			// Користувач відмовився - пробуємо API (викличе помилку про відсутність ключа)
		}

		// Спробуємо API
		try {
			commitMessage = await generateWithAPI(prompt);
			return commitMessage;
		} catch (error) {
			if (cliNotFound && error.message.includes("ANTHROPIC_API_KEY")) {
				throw new Error(
					"Claude CLI not found and no API key configured. Either configure CLI path in settings or set ANTHROPIC_API_KEY.",
				);
			}
			throw new Error(`Failed to generate commit: ${error.message}`);
		}
	}

	throw new Error(
		"No generation method available. Install Claude Code CLI or set API key.",
	);
}

module.exports = {
	generateCommitMessage,
	promptForCliPath,
	findClaudeCliPath,
};
