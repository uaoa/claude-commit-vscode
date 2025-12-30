export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean,
  commitStyle: string = "conventional"
): string {
  const diffContent = diff.slice(0, 6000);
  const styleInstructions = getStyleInstructions(commitStyle, multiLine);

  if (multiLine) {
    return `分析 git 变更并生成详细 commit message。

变更统计：
${stats}

Diff（前 6000 个字符）：
${diffContent}

${styleInstructions}

仅返回指定格式的 commit message，不要有任何解释。`;
  }

  return `分析 git 变更并生成 commit message。

变更统计：
${stats}

Diff（前 6000 个字符）：
${diffContent}

${styleInstructions}

仅返回 commit message（一行），不要有任何解释。`;
}

function getStyleInstructions(style: string, multiLine: boolean): string {
  switch (style) {
    case "conventional":
      return multiLine ? `回复格式：
<type>(<scope>): <subject>

<body>

<footer>

规则：
- Subject：过去时态，最多 50 个字符，不加句号
- Body：详细描述变更内容（改了什么、为什么改）
- Footer：Breaking changes、issue 引用
- Type：feat/fix/refactor/docs/style/test/chore/perf
- 使用动词：添加了、修复了、更新了、删除了、重构了

示例：
feat(auth): 添加了 Google OAuth 登录

实现了通过 Google OAuth 2.0 的身份验证。
添加了令牌处理和刷新机制。
更新了配置以支持新的登录提供商。

Closes #123` : `严格规则：
- 格式：<type>(<scope>): <subject>
- Type：feat/fix/refactor/docs/style/test/chore/perf
- Subject 使用过去时态（描述完成了什么），最多 50 个字符，不加句号
- 使用动词：添加了、修复了、更新了、删除了、重构了
- 错误示例："添加功能"、"修复 bug"、"更新样式"
- 正确示例："添加了功能"、"修复了 bug"、"更新了样式"

示例：
feat(auth): 添加了 Google OAuth 登录
fix(api): 修复了 user endpoint 的验证错误
refactor(store): 优化了购物车状态管理
docs(readme): 更新了安装说明`;

    case "prefix":
      return multiLine ? `回复格式：
<type>: <subject>

<body>

<footer>

规则：
- Subject：过去时态，最多 50 个字符，不加句号
- Body：详细描述变更内容（改了什么、为什么改）
- Footer：Breaking changes、issue 引用
- Type：feat/fix/refactor/docs/style/test/chore/perf
- 使用动词：添加了、修复了、更新了、删除了、重构了
- 不要 scope 括号

示例：
feat: 添加了 Google OAuth 登录

实现了通过 Google OAuth 2.0 的身份验证。
添加了令牌处理和刷新机制。

Closes #123` : `严格规则：
- 格式：<type>: <subject>
- Type：feat/fix/refactor/docs/style/test/chore/perf
- Subject 使用过去时态（描述完成了什么），最多 50 个字符，不加句号
- 使用动词：添加了、修复了、更新了、删除了、重构了
- 不要 scope 括号

示例：
feat: 添加了 Google OAuth 登录
fix: 修复了 user endpoint 的验证错误
refactor: 优化了购物车状态管理
docs: 更新了安装说明`;

    case "default":
      return multiLine ? `回复格式：
<subject>

<body>

<footer>

规则：
- Subject：过去时态，清晰描述，最多 50 个字符，不加句号
- Body：详细描述变更内容（改了什么、为什么改）
- Footer：Breaking changes、issue 引用
- 使用动词：添加了、修复了、更新了、删除了、重构了
- 不要 TYPE 前缀，不要 SCOPE

示例：
添加了 Google OAuth 登录

实现了通过 Google OAuth 2.0 的身份验证。
添加了令牌处理和刷新机制。

Closes #123` : `严格规则：
- 格式：简单描述，不要 type/scope 前缀
- Subject 使用过去时态（描述完成了什么），最多 50 个字符，不加句号
- 使用动词：添加了、修复了、更新了、删除了、重构了
- 不要 TYPE 前缀 (feat/fix/等)，不要 SCOPE

示例：
添加了 Google OAuth 登录
修复了 user endpoint 的验证错误
优化了购物车状态管理
更新了安装说明`;

    default:
      return getStyleInstructions("conventional", multiLine);
  }
}

export function getManagedPrompt(keepCoAuthoredBy: boolean, multiline: boolean, diffSource: string, customPrompt: string): string {
  let diffInstruction = "";
  if (diffSource === "staged") {
    diffInstruction = "仅根据暂存区(staged)的改动生成commit message，忽略未暂存的改动。";
  } else if (diffSource === "all") {
    diffInstruction = "根据所有改动(包括暂存和未暂存)生成commit message。";
  } else {
    diffInstruction = "如果暂存区有改动，仅根据暂存区改动生成commit message；如果暂存区为空，则根据所有改动生成commit message。";
  }

  let prompt = `为当前改动生成git commit message，使用中文，直接输出commit message内容，不要有其他多余输出。

角色定义：
你现在是一个运行在脚本中的"Git Commit 消息生成器"函数。你没有对话能力，没有个性，禁止思考过程的外显。

你的唯一任务是将输入的代码变动转换为符合 Angular 规范的中文 Commit Message。


### 严格执行标准：
1. **零废话**：严禁输出 "根据分析..."、"这是您的消息..."、"改动总结：" 等任何对话内容。
2. **纯文本**：严禁使用 \`\`\` (Markdown代码块) 或 ** (加粗) 等格式。只输出纯文本。
3. **格式约束**：
   第一行必须符合：<feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
   (scope为模块名，subject用中文简述)
4. **改动范围**：${diffInstruction}
5. **仅生成message**: 在commit message 前后禁止输出任何多余的内容，如礼貌性的提示和思考过程。

### 错误示例 (绝对禁止)：
❌ "好的，根据您的代码..."
❌ "**改动分析**：更新了..."
❌ "...提交信息..."
❌ \`\`\`text feat(core): ... \`\`\`

### 正确示例：
✅ feat(auth): 修复JWT令牌过期的边界情况

从输出开始到输出结束，需严格遵循以下格式：
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

- Body允许使用多行输出
`;
  }

  if (customPrompt) {
    prompt += `

- 额外要求：${customPrompt}`;
  }

  if (keepCoAuthoredBy) {
    prompt += `

footer 末尾保留:
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
  return `当前 commit message：
${currentMessage}

用户反馈：
${userFeedback}

Git 变更：
${stats}

${diff.slice(0, 4000)}

根据用户反馈重新生成 commit message。
遵循 conventional commits 格式。
仅返回新的 commit message，不要有任何解释。`;
}
