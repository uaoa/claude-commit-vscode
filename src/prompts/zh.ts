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
    return `分析 git 变更并生成详细 commit message。

变更统计：
${stats}

Diff（前 6000 个字符）：
${diffContent}

${styleInstructions}

仅返回指定格式的 commit message，不要有任何解释，不要 markdown，不要代码块（不要 \`\`\`）。`;
  }

  return `分析 git 变更并生成 commit message。

变更统计：
${stats}

Diff（前 6000 个字符）：
${diffContent}

${styleInstructions}

仅返回 commit message（一行），不要有任何解释，不要 markdown，不要代码块（不要 \`\`\`）。`;
}

function getTenseRules(tense: Tense): { instruction: string; wrong: string; right: string; verbs: string } {
  if (tense === "past") {
    return {
      instruction: "Subject 使用过去时态（描述完成了什么），最多 50 个字符，不加句号",
      wrong: '错误示例："添加功能"、"修复 bug"、"更新样式"',
      right: '正确示例："添加了功能"、"修复了 bug"、"更新了样式"',
      verbs: "添加了、修复了、更新了、删除了、重构了",
    };
  }
  return {
    instruction: "Subject 使用祈使句（命令式，现在时），最多 50 个字符，不加句号",
    wrong: '错误示例："添加了功能"、"修复了 bug"、"更新了样式"',
    right: '正确示例："添加功能"、"修复 bug"、"更新样式"',
    verbs: "添加、修复、更新、删除、重构",
  };
}

function getStyleInstructions(style: string, multiLine: boolean, tense: Tense): string {
  const t = getTenseRules(tense);
  const past = tense === "past";
  const a = past ? "添加了" : "添加";
  const b = past ? "修复了" : "修复";
  const c = past ? "优化了" : "优化";
  const d = past ? "更新了" : "更新";
  const bodyImpl = past ? "实现了" : "实现";
  const bodyAdd = past ? "添加了" : "添加";
  const bodyUpd = past ? "更新了" : "更新";

  switch (style) {
    case "conventional":
      return multiLine
        ? `回复格式：
<type>(<scope>): <subject>

<body>

<footer>

规则：
- ${t.instruction}
- Body：详细描述变更内容（改了什么、为什么改）
- Footer：Breaking changes、issue 引用
- Type：feat/fix/refactor/docs/style/test/chore/perf
- 使用动词：${t.verbs}

示例：
feat(auth): ${a} Google OAuth 登录

${bodyImpl}通过 Google OAuth 2.0 的身份验证。
${bodyAdd}令牌处理和刷新机制。
${bodyUpd}配置以支持新的登录提供商。

Closes #123`
        : `严格规则：
- 格式：<type>(<scope>): <subject>
- Type：feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- 使用动词：${t.verbs}
- ${t.wrong}
- ${t.right}

示例：
feat(auth): ${a} Google OAuth 登录
fix(api): ${b} user endpoint 的验证错误
refactor(store): ${c}购物车状态管理
docs(readme): ${d}安装说明`;

    case "prefix":
      return multiLine
        ? `回复格式：
<type>: <subject>

<body>

<footer>

规则：
- ${t.instruction}
- Body：详细描述变更内容（改了什么、为什么改）
- Footer：Breaking changes、issue 引用
- Type：feat/fix/refactor/docs/style/test/chore/perf
- 使用动词：${t.verbs}
- 不要 scope 括号

示例：
feat: ${a} Google OAuth 登录

${bodyImpl}通过 Google OAuth 2.0 的身份验证。
${bodyAdd}令牌处理和刷新机制。

Closes #123`
        : `严格规则：
- 格式：<type>: <subject>
- Type：feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- 使用动词：${t.verbs}
- 不要 scope 括号

示例：
feat: ${a} Google OAuth 登录
fix: ${b} user endpoint 的验证错误
refactor: ${c}购物车状态管理
docs: ${d}安装说明`;

    case "default":
      return multiLine
        ? `回复格式：
<subject>

<body>

<footer>

规则：
- ${t.instruction}
- Body：详细描述变更内容（改了什么、为什么改）
- Footer：Breaking changes、issue 引用
- 使用动词：${t.verbs}
- 不要 TYPE 前缀，不要 SCOPE

示例：
${a} Google OAuth 登录

${bodyImpl}通过 Google OAuth 2.0 的身份验证。
${bodyAdd}令牌处理和刷新机制。

Closes #123`
        : `严格规则：
- 格式：简单描述，不要 type/scope 前缀
- ${t.instruction}
- 使用动词：${t.verbs}
- 不要 TYPE 前缀 (feat/fix/等)，不要 SCOPE

示例：
${a} Google OAuth 登录
${b} user endpoint 的验证错误
${c}购物车状态管理
${d}安装说明`;

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
      ? "- Subject 使用过去时态中文，最多50字符，不加句号\n- 使用动词：添加了、修复了、更新了、删除了、重构了"
      : "- Subject 使用祈使句（命令式，现在时），最多50字符，不加句号\n- 使用动词：添加、修复、更新、删除、重构";

  let systemPrompt = `你是"Git Commit 消息生成器"函数。你没有对话能力。仅输出纯文本 commit message。

规则：
- 第一行：<feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
${tenseRule}
- 禁止 markdown、代码块、代码围栏（不要 \`\`\`）、解释`;

  if (multiline) {
    systemPrompt += `
- 空行后添加详细描述的 body`;
  }

  if (keepCoAuthoredBy) {
    systemPrompt += `
- footer 末尾保留:
🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>`;
  }

  if (customPrompt) {
    systemPrompt += `
- 额外要求：${customPrompt}`;
  }

  const userPrompt = `变更统计：
${stats}

Diff（前6000个字符）：
${diffContent}`;

  return { systemPrompt, userPrompt };
}

export function getEditPrompt(currentMessage: string, userFeedback: string, diff: string, stats: string): string {
  return `当前 commit message：
${currentMessage}

用户反馈：
${userFeedback}

Git 变更：
${stats}

${diff.slice(0, 4000)}

根据用户反馈重新生成 commit message。
遵循 conventional commits 格式。
仅返回新的 commit message，不要有任何解释，不要 markdown，不要代码块。`;
}
