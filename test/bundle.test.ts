// Smoke tests against the built dist/extension.js (what actually ships in the
// .vsix) with a mocked `vscode` module. They run offline: the Anthropic API is
// served by a stubbed fetch and the Claude CLI by a fake script.
import { after, before, beforeEach, test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// biome-ignore lint: test file
type AnyFn = (...args: any[]) => any;

const bundlePath = path.resolve(__dirname, "..", "..", "dist", "extension.js");
const isWindows = process.platform === "win32";

let tmpDir: string;
let repoDir: string;
let config: Record<string, unknown>;
let secretStore: Map<string, string>;
let errors: string[];
let cancelAfterMs: number | undefined;
const commands: Record<string, AnyFn> = {};
const repo = {
  rootUri: { fsPath: "" },
  inputBox: { value: "" },
  state: { indexChanges: [1], workingTreeChanges: [] as unknown[] },
};

const vscodeMock = {
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  commands: {
    registerCommand: (id: string, cb: AnyFn) => {
      commands[id] = cb;
      return { dispose() {} };
    },
  },
  extensions: {
    all: [],
    getExtension: (id: string) =>
      id === "vscode.git"
        ? { exports: { getAPI: () => ({ git: { path: "git" }, repositories: [repo], state: {} }) } }
        : undefined,
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    withProgress: (_options: unknown, cb: AnyFn) => {
      const listeners: AnyFn[] = [];
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: (fn: AnyFn) => {
          listeners.push(fn);
          return { dispose() {} };
        },
      };
      if (cancelAfterMs !== undefined) {
        setTimeout(() => {
          token.isCancellationRequested = true;
          for (const fn of listeners) fn();
        }, cancelAfterMs);
      }
      return cb({ report() {} }, token);
    },
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: (message: string) => {
      errors.push(message);
      return Promise.resolve(undefined);
    },
    showErrorMessage: (message: string) => {
      errors.push(message);
      return Promise.resolve(undefined);
    },
    showInputBox: () => Promise.resolve(undefined),
    showOpenDialog: () => Promise.resolve(undefined),
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => (key in config ? config[key] : fallback),
      inspect: (key: string) => ({ globalValue: config[key] }),
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
};

function writeFakeCli(name: string, body: string): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

async function generate(): Promise<void> {
  repo.inputBox.value = "";
  await commands["claude-commit.generate"]();
}

before(() => {
  assert.ok(fs.existsSync(bundlePath), `Bundle not found at ${bundlePath} — run "npm run package" first`);

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-commit-test-"));
  repoDir = path.join(tmpDir, "repo");
  fs.mkdirSync(repoDir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoDir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  fs.writeFileSync(path.join(repoDir, "a.ts"), "export const a = 1;\n");
  git("add", "a.ts");
  repo.rootUri.fsPath = repoDir;

  const Module = require("module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...rest: unknown[]) {
    return request === "vscode" ? vscodeMock : originalLoad.call(this, request, ...rest);
  };
  const extension = require(bundlePath);
  secretStore = new Map();
  config = {};
  errors = [];
  extension.activate({
    subscriptions: [],
    secrets: {
      get: async (key: string) => secretStore.get(key),
      store: async (key: string, value: string) => void secretStore.set(key, value),
      delete: async (key: string) => void secretStore.delete(key),
    },
    globalState: { get: () => true, update: async () => {} },
  });
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  config = {};
  errors = [];
  cancelAfterMs = undefined;
  secretStore.clear();
});

test("activation registers all commands", () => {
  for (const id of ["claude-commit.generate", "claude-commit.generateWithCustomPrompt", "claude-commit.setApiKey"]) {
    assert.equal(typeof commands[id], "function", id);
  }
});

test("API mode works from the bundle (SDK is bundled) with current request shape", async (t) => {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "m",
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "feat(api): add greeting" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  secretStore.set("claudeCommit.apiKey", "sk-ant-from-secret-storage");
  config = { preferredMethod: "api", model: "sonnet" };
  await generate();
  assert.deepEqual(errors, []);
  assert.equal(repo.inputBox.value, "feat(api): add greeting");
  assert.equal(requests[0].headers["x-api-key"], "sk-ant-from-secret-storage");
  assert.equal(requests[0].body.model, "claude-sonnet-5");
  assert.equal(requests[0].body.temperature, undefined);
  assert.deepEqual(requests[0].body.output_config, { effort: "low" });

  config = { preferredMethod: "api", model: "haiku", apiKey: "sk-ant-from-settings" };
  secretStore.clear();
  await generate();
  assert.equal(requests[1].headers["x-api-key"], "sk-ant-from-settings");
  assert.equal(requests[1].body.model, "claude-haiku-4-5");
  assert.equal(requests[1].body.output_config, undefined);

  config = { preferredMethod: "api", model: "haiku", customModel: "claude-opus-5-5", apiKey: "k" };
  await generate();
  assert.equal(requests[2].body.model, "claude-opus-5-5");
});

test("CLI mode passes arguments intact, disables thinking and runs from a neutral cwd", { skip: isWindows }, async () => {
  const report = path.join(tmpDir, "cli-report.json");
  const cli = writeFakeCli(
    "claude-ok",
    `const fs = require("fs");
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), thinking: process.env.MAX_THINKING_TOKENS, input }));
  process.stdout.write("Here is your commit message:\\nfeat(core): add constant a\\n");
});`
  );
  config = { preferredMethod: "cli", cliPath: cli, language: "en" };
  await generate();
  assert.deepEqual(errors, []);
  assert.equal(repo.inputBox.value, "feat(core): add constant a");

  const seen = JSON.parse(fs.readFileSync(report, "utf8"));
  const toolsIndex = seen.argv.indexOf("--tools");
  assert.equal(seen.argv[toolsIndex + 1], "");
  assert.equal(seen.argv[seen.argv.indexOf("--effort") + 1], "low");
  assert.equal(seen.argv[seen.argv.indexOf("--model") + 1], "haiku");
  assert.equal(seen.thinking, "0");
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(os.tmpdir()));
  assert.ok(seen.input.includes("export const a = 1;"));
  assert.ok(seen.input.includes("in English"));
});

test("cancelling stops the CLI quickly and shows no error", { skip: isWindows }, async () => {
  const cli = writeFakeCli("claude-slow", "setTimeout(() => console.log('feat: too late'), 30000);");
  config = { preferredMethod: "cli", cliPath: cli };
  cancelAfterMs = 300;
  const started = Date.now();
  await generate();
  assert.ok(Date.now() - started < 5000, "generation was not cancelled");
  assert.deepEqual(errors, []);
  assert.equal(repo.inputBox.value, "");
});

test("auto mode surfaces the CLI error when no API key is configured", { skip: isWindows }, async (t) => {
  const savedEnvKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    if (savedEnvKey !== undefined) process.env.ANTHROPIC_API_KEY = savedEnvKey;
  });
  const cli = writeFakeCli("claude-broken", "console.error('Not logged in · Please run /login'); process.exit(1);");
  config = { preferredMethod: "auto", cliPath: cli };
  await generate();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Claude CLI error: .*Not logged in/);
});
