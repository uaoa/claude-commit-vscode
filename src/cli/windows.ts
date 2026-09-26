// .cmd/.bat wrappers (npm installs) on Windows only run through cmd.exe;
// native binaries (claude.exe from the installer or the VS Code extension)
// are spawned directly, which also keeps arguments intact.
export function needsWindowsShell(cliPath: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && !/\.exe$/i.test(cliPath);
}

// With `shell: true` Node joins arguments with plain spaces, so an empty
// argument (`--tools ""`) disappears and paths with spaces split apart.
export function quoteForCmd(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^()%!]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}
