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

export function getManagedPrompt(keepCoAuthoredBy: boolean, multiline: boolean, diffSource: string, customPrompt: string): string {
  let diffInstruction = "";
  if (diffSource === "staged") {
    diffInstruction = "Generate commit message based ONLY on staged changes, ignore unstaged changes.";
  } else if (diffSource === "all") {
    diffInstruction = "Generate commit message based on ALL changes (both staged and unstaged).";
  } else {
    diffInstruction = "If there are staged changes, generate commit message based on staged only; if staging area is empty, generate based on all changes.";
  }

  let prompt = `Generate a git commit message for current changes, in English, output only the commit message content directly, no other text.

Role Definition:
You are now a "Git Commit Message Generator" function running in a script. You have no conversational ability, no personality, and no externalization of thought processes.

Your only task is to convert input code changes into English Commit Messages that conform to the Angular specification.


### Strict Execution Standards:
1. **Zero nonsense**: Absolutely no output like "Based on analysis...", "Here's your message...", "Summary of changes:" or any conversational content.
2. **Plain text**: Absolutely no use of \`\`\` (Markdown code blocks) or ** (bold) formatting. Output plain text only.
3. **Format constraint**:
   First line must conform to: <feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
   (scope is the module name, subject is a brief description in English)
4. **Change scope**: ${diffInstruction}
5. **Generate message only**: Absolutely no extra content before or after commit message, such as polite hints or thinking processes.

### Wrong examples (absolutely forbidden):
❌ "Okay, based on your code..."
❌ "**Change analysis**: Updated..."
❌ "...commit message:"
❌ \`\`\`text feat(core): ... \`\`\`

### Correct example:
✅ feat(auth): fix JWT token expiration edge case

From output start to output end, strictly follow this format:
<feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>`;

  if (multiline) {
    prompt += `

<body>`;
  }

  if (keepCoAuthoredBy) {
    prompt += `

<footer>`;
  }

  if (multiline) {
    prompt += `

- Body allows multiline output
`;
  }

  if (customPrompt) {
    prompt += `

- Additional requirements: ${customPrompt}`;
  }

  if (keepCoAuthoredBy) {
    prompt += `

Keep at the end of footer:
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
