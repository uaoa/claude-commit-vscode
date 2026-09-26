import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "path";
import { extractCommitMessage, stripCodeFences } from "../src/cli/output";
import { needsWindowsShell, quoteForCmd } from "../src/cli/windows";
import { prioritizeDiff } from "../src/utils/git";
import { isInsideFolder } from "../src/utils/paths";
import { createEditPrompt, createGenerationPrompt } from "../src/prompts/generation";

test("quoteForCmd keeps empty and spaced arguments intact for cmd.exe", () => {
  assert.equal(quoteForCmd(""), '""');
  assert.equal(quoteForCmd("--tools"), "--tools");
  assert.equal(quoteForCmd("C:\\Program Files\\nodejs\\claude.cmd"), '"C:\\Program Files\\nodejs\\claude.cmd"');
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
  assert.equal(quoteForCmd("sonnet[1m]"), "sonnet[1m]");
});

test("needsWindowsShell only for non-.exe paths on Windows", () => {
  assert.equal(needsWindowsShell("C:\\npm\\claude.cmd", "win32"), true);
  assert.equal(needsWindowsShell("C:\\Users\\u\\.local\\bin\\claude.EXE", "win32"), false);
  assert.equal(needsWindowsShell("/usr/local/bin/claude", "linux"), false);
  assert.equal(needsWindowsShell("/usr/local/bin/claude", "darwin"), false);
});

test("extractCommitMessage drops preamble in single-line mode", () => {
  assert.equal(extractCommitMessage("Here is the message:\nfeat(api): add login\n", false), "feat(api): add login");
  assert.equal(extractCommitMessage("```\nfix: handle null\n```", false), "fix: handle null");
});

test("extractCommitMessage recognizes build/ci/revert and breaking marker", () => {
  assert.equal(extractCommitMessage("Sure.\nci: cache npm", false), "ci: cache npm");
  assert.equal(extractCommitMessage("Sure.\nfeat(api)!: drop v1", false), "feat(api)!: drop v1");
  assert.equal(extractCommitMessage("Sure.\nrevert: undo change", false), "revert: undo change");
});

test("extractCommitMessage keeps body and blank lines in multi-line mode", () => {
  const out = "Here you go:\n\nfeat(auth): add OAuth\n\nImplement Google OAuth.\nAdd refresh.\n\nCloses #1\n";
  assert.equal(extractCommitMessage(out, true), "feat(auth): add OAuth\n\nImplement Google OAuth.\nAdd refresh.\n\nCloses #1");
});

test("extractCommitMessage falls back to last line for non-conventional styles", () => {
  assert.equal(extractCommitMessage("add login button", false), "add login button");
  assert.equal(extractCommitMessage("   \n\n", false), "");
});

test("stripCodeFences removes dangling fences", () => {
  assert.equal(stripCodeFences("```text\nfeat: x"), "feat: x");
});

test("prioritizeDiff moves lock files last without dropping anything", () => {
  const lock = "diff --git a/package-lock.json b/package-lock.json\n+lock\n";
  const code = "diff --git a/src/a.ts b/src/a.ts\n+code\n";
  const yarn = "diff --git a/web/yarn.lock b/web/yarn.lock\n+y\n";
  const result = prioritizeDiff(lock + code + yarn);
  assert.ok(result.startsWith(code));
  assert.equal(result.length, (lock + code + yarn).length);
  assert.ok(result.includes(lock) && result.includes(yarn));
  assert.equal(prioritizeDiff(""), "");
});

test("isInsideFolder does not match sibling folders sharing a prefix", () => {
  const root = path.join(path.sep, "work", "repo");
  assert.equal(isInsideFolder(path.join(root, "src", "a.ts"), root), true);
  assert.equal(isInsideFolder(root, root), true);
  assert.equal(isInsideFolder(path.join(path.sep, "work", "repo-other", "a.ts"), root), false);
});

test("custom template keeps $-patterns from the diff literally", () => {
  const diff = "+ return `Hello ${name} $& $1 $'`;";
  const prompt = createGenerationPrompt(diff, "1 file", "en", false, "custom", "Msg for:\n{diff}\n{stats}");
  assert.ok(prompt.includes(diff));
  assert.throws(() => createGenerationPrompt(diff, "", "en", false, "custom", "  "));
});

test("edit prompt keeps the current format instead of forcing conventional commits", () => {
  for (const lang of ["en", "ua", "zh", "ko"] as const) {
    const prompt = createEditPrompt("add login button", "shorter", "diff", "stats", lang);
    assert.ok(!/conventional commits (format|形式)|формату conventional|conventional commits 格式/.test(prompt), lang);
  }
  assert.ok(createEditPrompt("x", "y", "d", "s", "en").includes("in English"));
});
