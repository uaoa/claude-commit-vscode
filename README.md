# Claude Commit - VS Code Extension

AI-powered Git commit message generator using Claude AI. Automatically generates conventional commit messages with a single click.

## Features

- **One-Click Generation**: Click the sparkle button in Source Control panel to generate commit messages
- **Conventional Commits**: Generates properly formatted conventional commit messages
- **Bilingual Support**: English and Ukrainian languages
- **Flexible AI Backend**: Works with Claude Code CLI or Anthropic API
- **Smart Fallback**: Automatically tries CLI first, then API

## Installation

### From Source

1. Clone this repository
2. Navigate to the `vscode-extension` folder
3. Run `npm install`
4. Press F5 to open Extension Development Host
5. Or run `vsce package` to create a .vsix file and install manually

## Setup

Choose one of the following methods:

### Option 1: Claude Code CLI (Recommended)

Install Claude Code CLI:
```bash
# Follow instructions at https://docs.claude.com/claude-code
```

### Option 2: Anthropic API

1. Get your API key from https://console.anthropic.com/
2. Add it to VS Code settings:
   - Open Settings (Cmd+, or Ctrl+,)
   - Search for "Claude Commit"
   - Enter your API key in "Claude Commit: Api Key"

Or set environment variable:
```bash
export ANTHROPIC_API_KEY="your-key-here"
```

## Usage

1. Make changes to your code
2. Stage files with `git add` (or use VS Code Source Control UI)
3. Click the **sparkle icon** ✨ in the Source Control panel (top right)
4. The commit message will be automatically generated and inserted into the message box
5. Review and commit!

## Configuration

Open VS Code settings and search for "Claude Commit":

- **API Key**: Your Anthropic API key (optional if using CLI)
- **Preferred Method**: Choose between `auto`, `cli`, or `api`
  - `auto`: Try CLI first, fallback to API
  - `cli`: Use only Claude Code CLI
  - `api`: Use only Anthropic API
- **Language**: Choose `en` (English) or `ua` (Ukrainian)

## Commands

- **Claude Commit: Generate Commit Message** - Generate AI-powered commit message

Access via:
- Sparkle button in Source Control panel
- Command Palette (Cmd+Shift+P / Ctrl+Shift+P) → "Claude Commit: Generate"

## Examples

Generated commit messages follow conventional commits format:

```
feat(auth): added Google OAuth provider
fix(api): fixed validation error in user endpoint
refactor(store): optimized cart state management
docs(readme): updated installation instructions
```

## Requirements

- VS Code 1.75.0 or higher
- Git repository
- One of:
  - Claude Code CLI installed
  - Anthropic API key

## License

MIT

## Author

Zakharii Melnyk
- GitHub: [@uaoa](https://github.com/uaoa)
- Email: contact@uaoa.dev
