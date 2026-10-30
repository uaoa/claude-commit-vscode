import * as vscode from "vscode";
import { log } from "./logger";

const LEGACY_SECTION = "claudeCommit";
const SECTION = "commitPen";
const MIGRATED_KEY = "commitPen.legacySettingsMigrated";

/**
 * Copy settings left by the previous extension (`claudeCommit.*`) to the
 * current keys (`commitPen.*`), once per scope. A value already set under the
 * new key always wins, and the legacy keys are left in place so the old
 * extension keeps working if it is still installed.
 */
export async function migrateLegacySettings(context: vscode.ExtensionContext): Promise<void> {
  const properties: Record<string, unknown> =
    context.extension?.packageJSON?.contributes?.configuration?.properties ?? {};
  const keys = Object.keys(properties).map((fullKey) => fullKey.slice(SECTION.length + 1));

  const scopes = [
    { target: vscode.ConfigurationTarget.Global, state: context.globalState, valueOf: "globalValue" },
    { target: vscode.ConfigurationTarget.Workspace, state: context.workspaceState, valueOf: "workspaceValue" },
  ] as const;

  for (const scope of scopes) {
    if (scope.state.get<boolean>(MIGRATED_KEY)) {
      continue;
    }
    if (scope.target === vscode.ConfigurationTarget.Workspace && !vscode.workspace.workspaceFolders?.length) {
      continue;
    }

    const legacy = vscode.workspace.getConfiguration(LEGACY_SECTION);
    const current = vscode.workspace.getConfiguration(SECTION);
    let copied = 0;

    for (const key of keys) {
      const legacyValue = legacy.inspect(key)?.[scope.valueOf];
      if (legacyValue === undefined || current.inspect(key)?.[scope.valueOf] !== undefined) {
        continue;
      }
      try {
        await current.update(key, legacyValue, scope.target);
        copied++;
      } catch (error) {
        log(`Could not migrate ${LEGACY_SECTION}.${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await scope.state.update(MIGRATED_KEY, true);
    if (copied > 0) {
      log(`Migrated ${copied} setting(s) from ${LEGACY_SECTION}.* to ${SECTION}.*`);
    }
  }
}
