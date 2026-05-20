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
    return `Analyze git changes and generate detailed commit message.

Change statistics:
${stats}

Diff (first 6000 characters):
${diffContent}

${styleInstructions}

Return ONLY the commit message in the specified format, no explanations, no markdown, no code fences (no \`\`\`).`;
  }

  return `Analyze git changes and generate commit message.

Change statistics:
${stats}

Diff (first 6000 characters):
${diffContent}

${styleInstructions}

Return ONLY the commit message (one line), no explanations, no markdown, no code fences (no \`\`\`).`;
}

function getTenseRules(tense: Tense): { instruction: string; wrong: string; right: string; verbs: string } {
  if (tense === "past") {
    return {
      instruction: "Subject in PAST TENSE (what WAS DONE), max 50 characters, no period",
      wrong: 'WRONG: "add feature", "fix bug", "update styles"',
      right: 'CORRECT: "added feature", "fixed bug", "updated styles"',
      verbs: "added, fixed, updated, removed, refactored",
    };
  }
  return {
    instruction: "Subject in IMPERATIVE MOOD (present tense, as a command), max 50 characters, no period",
    wrong: 'WRONG: "added feature", "fixed bug", "updated styles"',
    right: 'CORRECT: "add feature", "fix bug", "update styles"',
    verbs: "add, fix, update, remove, refactor",
  };
}

function getStyleInstructions(style: string, multiLine: boolean, tense: Tense): string {
  const t = getTenseRules(tense);
  const exampleVerbA = tense === "past" ? "added" : "add";
  const exampleVerbB = tense === "past" ? "fixed" : "fix";
  const exampleVerbC = tense === "past" ? "optimized" : "optimize";
  const exampleVerbD = tense === "past" ? "updated" : "update";

  switch (style) {
    case "conventional":
      return multiLine
        ? `RESPONSE FORMAT:
<type>(<scope>): <subject>

<body>

<footer>

RULES:
- ${t.instruction}
- Body: detailed description of changes (what and why)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Use verbs: ${t.verbs}

Example:
feat(auth): ${exampleVerbA} Google OAuth provider

${tense === "past" ? "Implemented" : "Implement"} authentication via Google OAuth 2.0.
${tense === "past" ? "Added" : "Add"} token handling and refresh mechanism.
${tense === "past" ? "Updated" : "Update"} configuration to support new providers.

Closes #123`
        : `STRICT RULES:
- Format: <type>(<scope>): <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- Use verbs like: ${t.verbs}
- ${t.wrong}
- ${t.right}

Examples:
feat(auth): ${exampleVerbA} Google OAuth provider
fix(api): ${exampleVerbB} validation error in user endpoint
refactor(store): ${exampleVerbC} cart state management
docs(readme): ${exampleVerbD} installation instructions`;

    case "prefix":
      return multiLine
        ? `RESPONSE FORMAT:
<type>: <subject>

<body>

<footer>

RULES:
- ${t.instruction}
- Body: detailed description of changes (what and why)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Use verbs: ${t.verbs}
- NO SCOPE in parentheses

Example:
feat: ${exampleVerbA} Google OAuth provider

${tense === "past" ? "Implemented" : "Implement"} authentication via Google OAuth 2.0.
${tense === "past" ? "Added" : "Add"} token handling and refresh mechanism.

Closes #123`
        : `STRICT RULES:
- Format: <type>: <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- Use verbs like: ${t.verbs}
- NO SCOPE in parentheses

Examples:
feat: ${exampleVerbA} Google OAuth provider
fix: ${exampleVerbB} validation error in user endpoint
refactor: ${exampleVerbC} cart state management
docs: ${exampleVerbD} installation instructions`;

    case "default":
      return multiLine
        ? `RESPONSE FORMAT:
<subject>

<body>

<footer>

RULES:
- ${t.instruction}
- Body: detailed description of changes (what and why)
- Footer: Breaking changes, issue references
- Use verbs: ${t.verbs}
- NO TYPE prefix, NO SCOPE

Example:
${exampleVerbA} Google OAuth provider

${tense === "past" ? "Implemented" : "Implement"} authentication via Google OAuth 2.0.
${tense === "past" ? "Added" : "Add"} token handling and refresh mechanism.

Closes #123`
        : `STRICT RULES:
- Format: simple description without type/scope prefix
- ${t.instruction}
- Use verbs like: ${t.verbs}
- NO TYPE prefix (feat/fix/etc), NO SCOPE

Examples:
${exampleVerbA} Google OAuth provider
${exampleVerbB} validation error in user endpoint
${exampleVerbC} cart state management
${exampleVerbD} installation instructions`;

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
      ? "- Subject in PAST TENSE, max 50 chars, no period (e.g. 'added X', 'fixed Y')"
      : "- Subject in IMPERATIVE MOOD (present tense, as a command), max 50 chars, no period (e.g. 'add X', 'fix Y')";

  let systemPrompt = `You are a "Git Commit Message Generator" function. You have no conversational ability. Output ONLY the commit message in plain text.

Rules:
- First line: <feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
${tenseRule}
- No markdown, no code blocks, no code fences (no \`\`\`), no explanations, no preamble`;

  if (multiline) {
    systemPrompt += `
- Include body with detailed description after blank line`;
  }

  if (keepCoAuthoredBy) {
    systemPrompt += `
- End with footer:
🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>`;
  }

  if (customPrompt) {
    systemPrompt += `
- Additional requirements: ${customPrompt}`;
  }

  const userPrompt = `Change statistics:
${stats}

Diff (first 6000 characters):
${diffContent}`;

  return { systemPrompt, userPrompt };
}

export function getEditPrompt(currentMessage: string, userFeedback: string, diff: string, stats: string): string {
  return `Current commit message:
${currentMessage}

User feedback:
${userFeedback}

Git changes:
${stats}

${diff.slice(0, 4000)}

Regenerate the commit message considering user feedback.
Follow conventional commits format.
Return ONLY the new commit message, no explanations, no markdown, no code fences.`;
}
