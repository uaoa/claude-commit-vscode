export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean
): string {
  if (multiLine) {
    return `Analyze git changes and generate detailed commit message in conventional commits format.

Change statistics:
${stats}

Diff (first 6000 characters):
${diff.slice(0, 6000)}

RESPONSE FORMAT:
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

Closes #123

Return ONLY the commit message in the specified format, no explanations.`;
  }

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

export function getManagedPrompt(keepCoAuthoredBy: boolean): string {
  let prompt = `Generate a git commit message for current changes, in English, output only the commit message, no other text.`;
  if (keepCoAuthoredBy) {
    prompt += `

Keep at the end of commit message:
🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>`;
  }
  return prompt;
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
