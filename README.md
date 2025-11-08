# Claude Commit

**Already using Claude Code? Get the commit message button you deserve – at no extra cost.**

A VS Code extension that brings the ✨ sparkle button to your Git panel, powered by the Claude CLI you already have. Generate intelligent commit messages without paying for additional AI services.

![demo](demo.png)

## Why Claude Commit?

You're already investing in Claude Code – whether it's Pro, Max ×5, or Max ×10. Why pay for Copilot or Cursor just for commit message generation? This extension leverages your existing Claude subscription to bring the same AI-powered commit message functionality directly to VS Code.

**Zero additional cost. Zero complexity. Just works.**

## Features

- **One-click commit message generation**: The sparkle button ✨ you know and love, right in VS Code's Source Control panel
- **Powered by your Claude CLI**: Uses your existing Claude installation – no extra API keys or subscriptions needed
- **Context-aware analysis**: Understands your git diff to generate meaningful, conventional commit messages
- **Bilingual support**: Works in English and Ukrainian
- **Flexible backend**: Automatically uses Claude CLI, with API fallback option
- **Seamless VS Code integration**: Works directly with the built-in Git interface

## Requirements

- VS Code 1.75.0 or higher
- Claude CLI installed and authenticated (comes with your Claude Code subscription)
- Git repository initialized in your workspace
- Internet connection for AI generation

## Installation

1. Install the extension from the VS Code Marketplace
2. Ensure Claude CLI is installed and available in your system PATH
3. Open a project with a Git repository
4. Look for the sparkle ✨ button in your Source Control panel

**That's it!** No configuration needed if you're using Claude CLI.

## How to Use

1. Make your code changes
2. Stage your changes (optional – works with unstaged changes too)
3. Click the sparkle ✨ button in the Source Control panel
4. Review the AI-generated commit message
5. Commit

**No configuration, no setup wizards, no complexity.**

## Extension Settings

This extension keeps it simple with just a few optional settings:

* `claude-commit.preferredMethod`: Choose AI backend (`auto`, `cli`, or `api`) – defaults to `auto`
* `claude-commit.apiKey`: Your Anthropic API key (only needed if using API method)
* `claude-commit.language`: Interface language (`en` for English, `ua` for Ukrainian)

## Configuration Examples

### Using only Claude CLI
```json
{
    "claude-commit.preferredMethod": "cli"
}
```

### Using Anthropic API as fallback
```json
{
    "claude-commit.preferredMethod": "auto",
    "claude-commit.apiKey": "your-api-key-here"
}
```

### Ukrainian interface
```json
{
    "claude-commit.language": "ua"
}
```

## Troubleshooting

### Claude CLI not found

If the extension can't find Claude CLI:

1. **Check Claude is installed**: Run in terminal:
   ```bash
   which claude
   ```
   This should show the path to Claude (e.g., `/Users/you/.nvm/versions/node/v22.13.0/bin/claude`)

2. **Verify authentication**: Ensure Claude CLI is authenticated:
   ```bash
   claude setup-token
   ```

3. **Common issues**:
   - **NVM users**: VS Code might not see NVM paths – restart VS Code after installing Claude
   - **macOS**: If using zsh, paths might differ between terminal and VS Code
   - **Windows**: Ensure Claude is in your system PATH

### No commit message generated

1. Ensure you have changes in your repository (staged or unstaged)
2. Check that Claude CLI is properly authenticated
3. Try using API method as fallback:
   - Get API key from https://console.anthropic.com/
   - Add to settings: `claude-commit.apiKey`
   - Set `claude-commit.preferredMethod` to `api`

### Extension not working

1. Check you're in a Git repository
2. Open Output panel (View → Output)
3. Look for error messages from the extension
4. Try generating a commit message manually via Command Palette:
   - Press `Cmd+Shift+P` (or `Ctrl+Shift+P`)
   - Type "Claude Commit: Generate"

## Privacy & Security

- Your code changes are processed through Claude CLI or Anthropic API
- No data is stored or transmitted by this extension beyond what Claude requires
- Authentication is handled by your existing Claude CLI setup or API key
- Code is only sent to Claude's servers through your authenticated session

## Examples

Generated commit messages follow conventional commits format:

```
feat(auth): added Google OAuth provider
fix(api): fixed validation error in user endpoint
refactor(store): optimized cart state management
docs(readme): updated installation instructions
```

## Contributing

Found a bug or have a feature request? Please open an issue on our [GitHub repository](https://github.com/uaoa/claude-commit-vscode).

## Author

Created by **Zakharii Melnyk**
- GitHub: [@uaoa](https://github.com/uaoa)
- LinkedIn: [undef-zakhar](https://www.linkedin.com/in/undef-zakhar)

## License

MIT License - see LICENSE file for details.

---

**Stop paying twice for AI commit messages. You've got Claude Code – now get the commit button. ✨**
