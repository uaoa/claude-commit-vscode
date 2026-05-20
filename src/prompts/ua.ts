type Tense = "imperative" | "past";

export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean,
  commitStyle: string = "conventional",
  tense: Tense = "imperative"
): string {
  const diffContent = diff.slice(0, 6000);
  const styleInstructions = getStyleInstructions(commitStyle, multiLine, tense);

  if (multiLine) {
    return `Проаналізуй git зміни та згенеруй детальний commit message.

Статистика змін:
${stats}

Diff (перші 6000 символів):
${diffContent}

${styleInstructions}

Поверни ТІЛЬКИ commit message у вказаному форматі, без пояснень, без markdown, без code fences (без \`\`\`).`;
  }

  return `Проаналізуй git зміни та згенеруй commit message.

Статистика змін:
${stats}

Diff (перші 6000 символів):
${diffContent}

${styleInstructions}

Поверни ТІЛЬКИ commit message (один рядок), без пояснень, без markdown, без code fences (без \`\`\`).`;
}

function getTenseRules(tense: Tense): { instruction: string; wrong: string; right: string; verbs: string } {
  if (tense === "past") {
    return {
      instruction: "Subject ТІЛЬКИ у МИНУЛОМУ ЧАСІ (що ЗРОБЛЕНО), макс 50 символів, без крапки",
      wrong: 'НЕПРАВИЛЬНО: "додати функцію", "виправити баг", "оновити стилі"',
      right: 'ПРАВИЛЬНО: "додано функцію", "виправлено баг", "оновлено стилі"',
      verbs: "додано, виправлено, оновлено, видалено, рефакторено",
    };
  }
  return {
    instruction: "Subject у НАКАЗОВОМУ СПОСОБІ (інфінітив, як команда), макс 50 символів, без крапки",
    wrong: 'НЕПРАВИЛЬНО: "додано функцію", "виправлено баг", "оновлено стилі"',
    right: 'ПРАВИЛЬНО: "додати функцію", "виправити баг", "оновити стилі"',
    verbs: "додати, виправити, оновити, видалити, рефакторити",
  };
}

function getStyleInstructions(style: string, multiLine: boolean, tense: Tense): string {
  const t = getTenseRules(tense);
  const past = tense === "past";
  const a = past ? "додано" : "додати";
  const b = past ? "виправлено" : "виправити";
  const c = past ? "оптимізовано" : "оптимізувати";
  const d = past ? "оновлено" : "оновити";
  const bodyImpl = past ? "Реалізовано" : "Реалізувати";
  const bodyAdd = past ? "Додано" : "Додати";
  const bodyUpd = past ? "Оновлено" : "Оновити";

  switch (style) {
    case "conventional":
      return multiLine
        ? `ФОРМАТ ВІДПОВІДІ:
<type>(<scope>): <subject>

<body>

<footer>

ПРАВИЛА:
- ${t.instruction}
- Body: детальний опис змін (що і чому змінено)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Дієслова: ${t.verbs}

Приклад:
feat(auth): ${a} Google OAuth провайдер

${bodyImpl} аутентифікацію через Google OAuth 2.0.
${bodyAdd} обробку токенів та refresh механізм.
${bodyUpd} конфігурацію для підтримки нових провайдерів.

Closes #123`
        : `СУВОРІ ПРАВИЛА:
- Формат: <type>(<scope>): <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- Використовуй дієслова: ${t.verbs}
- ${t.wrong}
- ${t.right}

Приклади:
feat(auth): ${a} Google OAuth провайдер
fix(api): ${b} помилку валідації в user endpoint
refactor(store): ${c} управління станом корзини
docs(readme): ${d} інструкції встановлення`;

    case "prefix":
      return multiLine
        ? `ФОРМАТ ВІДПОВІДІ:
<type>: <subject>

<body>

<footer>

ПРАВИЛА:
- ${t.instruction}
- Body: детальний опис змін (що і чому змінено)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Дієслова: ${t.verbs}
- БЕЗ SCOPE в дужках

Приклад:
feat: ${a} Google OAuth провайдер

${bodyImpl} аутентифікацію через Google OAuth 2.0.
${bodyAdd} обробку токенів та refresh механізм.

Closes #123`
        : `СУВОРІ ПРАВИЛА:
- Формат: <type>: <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- Використовуй дієслова: ${t.verbs}
- БЕЗ SCOPE в дужках

Приклади:
feat: ${a} Google OAuth провайдер
fix: ${b} помилку валідації в user endpoint
refactor: ${c} управління станом корзини
docs: ${d} інструкції встановлення`;

    case "default":
      return multiLine
        ? `ФОРМАТ ВІДПОВІДІ:
<subject>

<body>

<footer>

ПРАВИЛА:
- ${t.instruction}
- Body: детальний опис змін (що і чому змінено)
- Footer: Breaking changes, issue references
- Використовуй дієслова: ${t.verbs}
- БЕЗ TYPE префікса, БЕЗ SCOPE

Приклад:
${a} Google OAuth провайдер

${bodyImpl} аутентифікацію через Google OAuth 2.0.
${bodyAdd} обробку токенів та refresh механізм.

Closes #123`
        : `СУВОРІ ПРАВИЛА:
- Формат: простий опис без type/scope префікса
- ${t.instruction}
- Використовуй дієслова: ${t.verbs}
- БЕЗ TYPE префікса (feat/fix/тощо), БЕЗ SCOPE

Приклади:
${a} Google OAuth провайдер
${b} помилку валідації в user endpoint
${c} управління станом корзини
${d} інструкції встановлення`;

    default:
      return getStyleInstructions("conventional", multiLine, tense);
  }
}

export function getManagedPrompt(
  diff: string,
  stats: string,
  keepCoAuthoredBy: boolean,
  multiline: boolean,
  customPrompt: string,
  tense: Tense = "imperative"
): { systemPrompt: string; userPrompt: string } {
  const diffContent = diff.slice(0, 6000);

  const tenseRule =
    tense === "past"
      ? "- Subject українською у МИНУЛОМУ ЧАСІ, макс 50 символів, без крапки\n- Дієслова: додано, виправлено, оновлено, видалено, рефакторено"
      : "- Subject українською у НАКАЗОВОМУ СПОСОБІ (інфінітив, як команда), макс 50 символів, без крапки\n- Дієслова: додати, виправити, оновити, видалити, рефакторити";

  let systemPrompt = `Ти "Генератор Git Commit повідомлень". Не маєш здатності до діалогу. Виводь ТІЛЬКИ commit message простим текстом.

Правила:
- Перший рядок: <feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
${tenseRule}
- Без markdown, без блоків коду, без code fences (без \`\`\`), без пояснень`;

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

export function getEditPrompt(currentMessage: string, userFeedback: string, diff: string, stats: string): string {
  return `Поточний commit message:
${currentMessage}

Відгук користувача:
${userFeedback}

Git зміни:
${stats}

${diff.slice(0, 4000)}

Перегенеруй commit message враховуючи відгук користувача.
Дотримуйся формату conventional commits.
Поверни ТІЛЬКИ новий commit message, без пояснень, без markdown, без code fences.`;
}
