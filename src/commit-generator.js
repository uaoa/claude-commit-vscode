const vscode = require('vscode');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Створення промпту для генерації commit message
 */
function createGenerationPrompt(diff, stats, lang) {
    const isUkrainian = lang === 'ua';

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
        const { stdout: diff } = await execAsync('git diff --cached --unified=1', {
            cwd: repoPath,
            maxBuffer: 10 * 1024 * 1024
        });

        const { stdout: stats } = await execAsync('git diff --cached --stat', {
            cwd: repoPath
        });

        return { diff: diff || '', stats: stats || '' };
    } catch (error) {
        // Якщо немає staged changes, спробуємо unstaged
        try {
            const { stdout: diff } = await execAsync('git diff --unified=1', {
                cwd: repoPath,
                maxBuffer: 10 * 1024 * 1024
            });

            const { stdout: stats } = await execAsync('git diff --stat', {
                cwd: repoPath
            });

            return { diff: diff || '', stats: stats || '' };
        } catch (err) {
            throw new Error('Failed to get git diff');
        }
    }
}

/**
 * Перевірка наявності Claude Code CLI
 */
async function hasClaudeCodeCLI() {
    try {
        await execAsync('which claude');
        return true;
    } catch {
        return false;
    }
}

/**
 * Генерація через Claude Code CLI
 */
async function generateWithCLI(prompt) {
    const command = `cat << 'CLAUDEPROMPT' | claude
${prompt}
CLAUDEPROMPT`;

    const { stdout } = await execAsync(command, {
        shell: '/bin/bash',
        maxBuffer: 10 * 1024 * 1024
    });

    // Парсимо відповідь - шукаємо conventional commit
    const lines = stdout.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const conventionalCommitPattern = /^(feat|fix|docs|style|refactor|test|chore|perf)(\(.+?\))?:.+/;

    for (let i = lines.length - 1; i >= 0; i--) {
        if (conventionalCommitPattern.test(lines[i])) {
            return lines[i];
        }
    }

    return lines[lines.length - 1] || 'chore: update code';
}

/**
 * Генерація через Anthropic API
 */
async function generateWithAPI(prompt) {
    const config = vscode.workspace.getConfiguration('claudeCommit');
    const apiKey = config.get('apiKey') || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not found. Set it in extension settings or environment variable.');
    }

    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey });

        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 500,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }]
        });

        return message.content[0].text.trim();
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
            throw new Error('Install @anthropic-ai/sdk to use API: npm install @anthropic-ai/sdk');
        }
        throw error;
    }
}

/**
 * Головна функція генерації commit message
 */
async function generateCommitMessage(repo, language = 'en') {
    const repoPath = repo.rootUri.fsPath;

    // Отримуємо diff
    const { diff, stats } = await getDiff(repoPath);

    if (!diff && !stats) {
        throw new Error('No changes found');
    }

    // Створюємо промпт
    const prompt = createGenerationPrompt(diff, stats, language);

    // Визначаємо метод генерації
    const config = vscode.workspace.getConfiguration('claudeCommit');
    const preferredMethod = config.get('preferredMethod', 'auto');

    let commitMessage;

    if (preferredMethod === 'cli' || preferredMethod === 'auto') {
        // Спробуємо CLI
        if (await hasClaudeCodeCLI()) {
            try {
                commitMessage = await generateWithCLI(prompt);
                return commitMessage;
            } catch (error) {
                if (preferredMethod === 'cli') {
                    throw new Error(`Claude CLI error: ${error.message}`);
                }
                // Якщо auto, спробуємо API
            }
        }
    }

    if (preferredMethod === 'api' || preferredMethod === 'auto') {
        // Спробуємо API
        try {
            commitMessage = await generateWithAPI(prompt);
            return commitMessage;
        } catch (error) {
            throw new Error(`Failed to generate commit: ${error.message}`);
        }
    }

    throw new Error('No generation method available. Install Claude Code CLI or set API key.');
}

module.exports = {
    generateCommitMessage
};
