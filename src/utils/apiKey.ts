import * as vscode from "vscode";
import { log } from "./logger";

const SECRET_KEY = "claudeCommit.apiKey";
const MIGRATION_PROMPTED_KEY = "claudeCommit.apiKeyMigrationPrompted";

let secrets: vscode.SecretStorage | undefined;

export function initApiKeyStorage(context: vscode.ExtensionContext): void {
  secrets = context.secrets;
}

async function readSecret(): Promise<string | undefined> {
  try {
    return (await secrets?.get(SECRET_KEY)) || undefined;
  } catch (error) {
    // e.g. no keyring available on Linux — fall back to settings/env
    log(`Could not read API key from secret storage: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Resolution order: OS secret storage (set via the "Set Anthropic API Key"
 * command) → `claudeCommit.apiKey` setting (legacy, still honored) →
 * ANTHROPIC_API_KEY environment variable.
 */
export async function getApiKey(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("claudeCommit");
  return (await readSecret()) || config.get<string>("apiKey") || process.env.ANTHROPIC_API_KEY || undefined;
}

export async function setApiKeyCommand(): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Anthropic API Key",
    prompt: "Stored in the OS secret storage (not in settings.json). Leave empty to remove the stored key.",
    placeHolder: "sk-ant-...",
    password: true,
    ignoreFocusOut: true,
  });

  // Escape pressed
  if (value === undefined) {
    return;
  }

  if (!secrets) {
    vscode.window.showErrorMessage("Secret storage is not available.");
    return;
  }

  const key = value.trim();
  if (key) {
    await secrets.store(SECRET_KEY, key);
    vscode.window.showInformationMessage("Anthropic API key saved to secure storage.");
  } else {
    await secrets.delete(SECRET_KEY);
    vscode.window.showInformationMessage("Stored Anthropic API key removed.");
  }
}

/**
 * Offer (once per machine) to move a key kept in user settings into secret
 * storage. Never done silently: secret storage is not covered by Settings
 * Sync, so clearing the synced setting could remove the key from the user's
 * other machines.
 */
export async function suggestApiKeyMigration(context: vscode.ExtensionContext): Promise<void> {
  if (!secrets || context.globalState.get<boolean>(MIGRATION_PROMPTED_KEY)) {
    return;
  }

  const config = vscode.workspace.getConfiguration("claudeCommit");
  const settingKey = config.inspect<string>("apiKey")?.globalValue?.trim();
  if (!settingKey || (await readSecret())) {
    return;
  }

  await context.globalState.update(MIGRATION_PROMPTED_KEY, true);

  const action = await vscode.window.showInformationMessage(
    "Claude Commit: your Anthropic API key is stored in plain text in settings.json. Move it to secure storage?",
    "Move to Secure Storage",
    "Keep in Settings"
  );
  if (action !== "Move to Secure Storage") {
    return;
  }

  try {
    await secrets.store(SECRET_KEY, settingKey);
    await config.update("apiKey", undefined, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      "API key moved to secure storage. Secure storage is not synced — run 'Claude Commit: Set Anthropic API Key' on your other machines."
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not move the API key: ${error instanceof Error ? error.message : String(error)}. It stays in settings.`
    );
  }
}
