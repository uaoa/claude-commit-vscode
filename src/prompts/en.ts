export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean,
  commitStyle: string = "conventional"
): string {
  const diffContent = diff.slice(0, 6000);

  const styleInstructions = getStyleInstructions(commitStyle, multiLine);

  if (multiLine) {
    return `Analyze git changes and generate detailed commit message.

Change statistics:
${stats}

Diff (first 6000 characters):
${diffContent}

${styleInstructions}

Return ONLY the commit message in the specified format, no explanations.`;
  }

  return `Analyze git changes and generate commit message.

Change statistics:
${stats}

Diff (first 6000 characters):
${diffContent}

${styleInstructions}

Return ONLY the commit message (one line), no explanations.`;
}

function getStyleInstructions(style: string, multiLine: boolean): string {
  switch (style) {
    case "conventional":
      return multiLine ? `RESPONSE FORMAT:
<type>(<scope>): <subject>

<body>

<footer>

RULES:
- Subject: PAST TENSE, max 50 characters, no period
- Body: detailed description of changes (what and why)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Use verbs: added, fixed, updated, removed, refactored

Example:
feat(auth): added Google OAuth provider

Implemented authentication via Google OAuth 2.0.
Added token handling and refresh mechanism.
Updated configuration to support new providers.

Closes #123` : `STRICT RULES:
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
docs(readme): updated installation instructions`;

    case "prefix":
      return multiLine ? `RESPONSE FORMAT:
<type>: <subject>

<body>

<footer>

RULES:
- Subject: PAST TENSE, max 50 characters, no period
- Body: detailed description of changes (what and why)
- Footer: Breaking changes, issue references
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Use verbs: added, fixed, updated, removed, refactored
- NO SCOPE in parentheses

Example:
feat: added Google OAuth provider

Implemented authentication via Google OAuth 2.0.
Added token handling and refresh mechanism.

Closes #123` : `STRICT RULES:
- Format: <type>: <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- Subject in PAST TENSE (what WAS DONE), max 50 characters, no period
- Use verbs like: added, fixed, updated, removed, refactored
- NO SCOPE in parentheses

Examples:
feat: added Google OAuth provider
fix: fixed validation error in user endpoint
refactor: optimized cart state management
docs: updated installation instructions`;

    case "default":
      return multiLine ? `RESPONSE FORMAT:
<subject>

<body>

<footer>

RULES:
- Subject: PAST TENSE, clear description, max 50 characters, no period
- Body: detailed description of changes (what and why)
- Footer: Breaking changes, issue references
- Use verbs: added, fixed, updated, removed, refactored
- NO TYPE prefix, NO SCOPE

Example:
added Google OAuth provider

Implemented authentication via Google OAuth 2.0.
Added token handling and refresh mechanism.

Closes #123` : `STRICT RULES:
- Format: simple description without type/scope prefix
- Subject in PAST TENSE (what WAS DONE), max 50 characters, no period
- Use verbs like: added, fixed, updated, removed, refactored
- NO TYPE prefix (feat/fix/etc), NO SCOPE

Examples:
added Google OAuth provider
fixed validation error in user endpoint
optimized cart state management
updated installation instructions`;

    default:
      return getStyleInstructions("conventional", multiLine);
  }
}

export function getManagedPrompt(diff: string, stats: string, keepCoAuthoredBy: boolean, multiline: boolean, customPrompt: string): { systemPrompt: string; userPrompt: string } {
  const diffContent = diff.slice(0, 6000);

  let systemPrompt = `You are a "Git Commit Message Generator" function. You have no conversational ability. Output ONLY the commit message in plain text.

Rules:
- First line: <feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
- Subject in PAST TENSE, max 50 chars, no period
- No markdown, no code blocks, no explanations, no preamble`;

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

export function getEditPrompt(
  currentMessage: string,
  userFeedback: string,
  diff: string,
  stats: string
): string {
  return `Current commit message:
${currentMessage}

User feedback:
${userFeedback}

Git changes:
${stats}

${diff.slice(0, 4000)}

Regenerate the commit message considering user feedback.
Follow conventional commits format.
Return ONLY the new commit message, no explanations.`;
}
