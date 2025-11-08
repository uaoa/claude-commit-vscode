# Icon Setup

The extension uses VS Code's built-in `$(sparkle)` icon for the commit generation button in the Source Control panel.

## Extension Icon

To add a custom extension icon, create a 128x128 PNG file named `icon.png` in the root of the extension folder.

You can:
1. Use any AI image generator to create a star/sparkle icon
2. Use a free icon from https://www.flaticon.com/
3. Create your own using design tools

The icon should represent:
- AI/automation (sparkle, star, magic wand)
- Git/commits (git logo, commit symbol)
- Claude branding (if desired)

Recommended colors: Purple, blue, or orange to match Claude branding.

For now, you can comment out the `"icon": "icon.png"` line in package.json to skip the icon requirement.
