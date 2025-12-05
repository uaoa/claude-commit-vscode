export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean
): string {
  if (multiLine) {
    return `分析 git 变更并生成符合 conventional commits 格式的详细 commit message。

变更统计：
${stats}

Diff（前 6000 个字符）：
${diff.slice(0, 6000)}

回复格式：
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

Closes #123

仅返回指定格式的 commit message，不要有任何解释。`;
  }

  return `分析 git 变更并生成符合 conventional commits 格式的 commit message。

变更统计：
${stats}

Diff（前 6000 个字符）：
${diff.slice(0, 6000)}

严格规则：
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
docs(readme): 更新了安装说明

仅返回 commit message（一行），不要有任何解释。`;
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
