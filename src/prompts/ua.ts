export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean
): string {
  if (multiLine) {
    return `Проаналізуй git зміни та згенеруй детальний commit message у форматі conventional commits.

Статистика змін:
${stats}

Diff (перші 6000 символів):
${diff.slice(0, 6000)}

ФОРМАТ ВІДПОВІДІ:
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

Closes #123

Поверни ТІЛЬКИ commit message у вказаному форматі, без пояснень.`;
  }

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
