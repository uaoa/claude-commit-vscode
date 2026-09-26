// Matches the first line of a Conventional Commits message, incl. `type!:` breaking marker
export const CONVENTIONAL_COMMIT_PATTERN =
  /^(feat|fix|docs|style|refactor|test|build|ci|chore|perf|revert)(\(.+?\))?!?:.+/;

/**
 * Strip markdown code fences (```...```) from Claude's output.
 * Handles cases where the model wraps the commit message in a fenced block
 * despite instructions not to.
 */
export function stripCodeFences(text: string): string {
  let result = text;

  // Match ```optional-lang\n...\n``` (entire fenced block) and extract content
  const fullFenceMatch = result.match(/```[^\n]*\n([\s\S]*?)\n```/);
  if (fullFenceMatch) {
    result = fullFenceMatch[1];
  } else {
    // Remove dangling fence markers anywhere (opening ```lang or closing ```)
    result = result.replace(/^[ \t]*```[^\n]*$/gmu, "");
  }

  return result.trim();
}

/**
 * Pull the commit message out of raw CLI output, dropping any preamble the
 * model added. Returns "" when the output has no usable lines.
 */
export function extractCommitMessage(stdout: string, multiLine: boolean): string {
  const cleanedStdout = stripCodeFences(stdout);

  const lines = cleanedStdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  if (multiLine) {
    let startIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (CONVENTIONAL_COMMIT_PATTERN.test(lines[i])) {
        startIndex = i;
        break;
      }
    }

    // Use the non-trimmed cleaned stdout to preserve blank lines between subject/body/footer.
    const preserveBlankLines = cleanedStdout.split("\n").map((line) => line.replace(/\s+$/u, ""));

    // Drop leading empty lines
    while (preserveBlankLines.length > 0 && preserveBlankLines[0].trim().length === 0) {
      preserveBlankLines.shift();
    }
    // Drop trailing empty lines
    while (preserveBlankLines.length > 0 && preserveBlankLines[preserveBlankLines.length - 1].trim().length === 0) {
      preserveBlankLines.pop();
    }

    if (startIndex >= 0) {
      // Find the same starting line in preserveBlankLines
      const target = lines[startIndex];
      const startInPreserve = preserveBlankLines.findIndex((l) => l.trim() === target);
      if (startInPreserve >= 0) {
        return preserveBlankLines.slice(startInPreserve).join("\n");
      }
      return lines.slice(startIndex).join("\n");
    }

    if (preserveBlankLines.length > 0) {
      return preserveBlankLines.join("\n");
    }
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    if (CONVENTIONAL_COMMIT_PATTERN.test(lines[i])) {
      return lines[i];
    }
  }

  return lines[lines.length - 1] || "chore: update code";
}
