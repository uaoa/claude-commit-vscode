export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean,
  commitStyle: string = "conventional"
): string {
  const diffContent = diff.slice(0, 6000);
  const styleInstructions = getStyleInstructions(commitStyle, multiLine);

  if (multiLine) {
    return `Проаналізуй git зміни та згенеруй детальний commit message.

Статистика змін:
${stats}

Diff (перші 6000 символів):
${diffContent}

${styleInstructions}

Поверни ТІЛЬКИ commit message у вказаному форматі, без пояснень.`;
  }

  return `Проаналізуй git зміни та згенеруй commit message.

Статистика змін:
${stats}

Diff (перші 6000 символів):
${diffContent}

${styleInstructions}

Поверни ТІЛЬКИ commit message (один рядок), без пояснень.`;
}

function getStyleInstructions(style: string, multiLine: boolean): string {
  switch (style) {
    case "conventional":
      return multiLine ? `ФОРМАТ ВІДПОВІДІ:
<type>(<scope>): <subject>

<body>

<footer>

ПРАВИЛА:
- Subject: МИНУЛИЙ ЧАС, макс 50 символів, без крапки
- Body: детальний опис змін (що і чому змінено)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Дієслова: додано, виправлено, оновлено, видалено, рефакторено

Приклад:
feat(auth): додано Google OAuth провайдер

Реалізовано аутентифікацію через Google OAuth 2.0.
Додано обробку токенів та refresh механізм.
Оновлено конфігурацію для підтримки нових провайдерів.

Closes #123` : `СУВОРІ ПРАВИЛА:
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
docs(readme): оновлено інструкції встановлення`;

    case "prefix":
      return multiLine ? `ФОРМАТ ВІДПОВІДІ:
<type>: <subject>

<body>

<footer>

ПРАВИЛА:
- Subject: МИНУЛИЙ ЧАС, макс 50 символів, без крапки
- Body: детальний опис змін (що і чому змінено)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Дієслова: додано, виправлено, оновлено, видалено, рефакторено
- БЕЗ SCOPE в дужках

Приклад:
feat: додано Google OAuth провайдер

Реалізовано аутентифікацію через Google OAuth 2.0.
Додано обробку токенів та refresh механізм.

Closes #123` : `СУВОРІ ПРАВИЛА:
- Формат: <type>: <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Subject ТІЛЬКИ у МИНУЛОМУ ЧАСІ (що ЗРОБЛЕНО), макс 50 символів, без крапки
- Використовуй дієслова: додано, виправлено, оновлено, видалено, рефакторено
- БЕЗ SCOPE в дужках

Приклади:
feat: додано Google OAuth провайдер
fix: виправлено помилку валідації в user endpoint
refactor: оптимізовано управління станом корзини
docs: оновлено інструкції встановлення`;

    case "default":
      return multiLine ? `ФОРМАТ ВІДПОВІДІ:
<subject>

<body>

<footer>

ПРАВИЛА:
- Subject: МИНУЛИЙ ЧАС, чіткий опис, макс 50 символів, без крапки
- Body: детальний опис змін (що і чому змінено)
- Footer: Breaking changes, issue references
- Використовуй дієслова: додано, виправлено, оновлено, видалено, рефакторено
- БЕЗ TYPE префікса, БЕЗ SCOPE

Приклад:
додано Google OAuth провайдер

Реалізовано аутентифікацію через Google OAuth 2.0.
Додано обробку токенів та refresh механізм.

Closes #123` : `СУВОРІ ПРАВИЛА:
- Формат: простий опис без type/scope префікса
- Subject ТІЛЬКИ у МИНУЛОМУ ЧАСІ (що ЗРОБЛЕНО), макс 50 символів, без крапки
- Використовуй дієслова: додано, виправлено, оновлено, видалено, рефакторено
- БЕЗ TYPE префікса (feat/fix/тощо), БЕЗ SCOPE

Приклади:
додано Google OAuth провайдер
виправлено помилку валідації в user endpoint
оптимізовано управління станом корзини
оновлено інструкції встановлення`;

    default:
      return getStyleInstructions("conventional", multiLine);
  }
}

export function getManagedPrompt(diff: string, stats: string, keepCoAuthoredBy: boolean, multiline: boolean, customPrompt: string): { systemPrompt: string; userPrompt: string } {
  const diffContent = diff.slice(0, 6000);

  let systemPrompt = `Ти "Генератор Git Commit повідомлень". Не маєш здатності до діалогу. Виводь ТІЛЬКИ commit message простим текстом.

Правила:
- Перший рядок: <feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
- Subject українською у МИНУЛОМУ ЧАСІ, макс 50 символів, без крапки
- Дієслова: додано, виправлено, оновлено, видалено, рефакторено
- Без markdown, без блоків коду, без пояснень`;

  if (multiline) {
    systemPrompt += `
- Додай body з детальним описом після порожнього рядка`;
  }

  if (keepCoAuthoredBy) {
    systemPrompt += `
- В кінці footer додай:
🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>`;
  }

  if (customPrompt) {
    systemPrompt += `
- Додаткові вимоги: ${customPrompt}`;
  }

  const userPrompt = `Статистика змін:
${stats}

Diff (перші 6000 символів):
${diffContent}`;

  return { systemPrompt, userPrompt };
}

export function getEditPrompt(
  currentMessage: string,
  userFeedback: string,
  diff: string,
  stats: string
): string {
  return `Поточний commit message:
${currentMessage}

Відгук користувача:
${userFeedback}

Git зміни:
${stats}

${diff.slice(0, 4000)}

Перегенеруй commit message враховуючи відгук користувача.
Дотримуйся формату conventional commits.
Поверни ТІЛЬКИ новий commit message, без пояснень.`;
}
