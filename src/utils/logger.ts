import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Claude Commit");
  }
  return outputChannel;
}

export function log(message: string): void {
  const channel = getOutputChannel();
  const timestamp = new Date().toISOString();
  channel.appendLine(`[${timestamp}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const channel = getOutputChannel();
  const timestamp = new Date().toISOString();
  channel.appendLine(`[${timestamp}] ERROR: ${message}`);
  if (error) {
    if (error instanceof Error) {
      channel.appendLine(`  Message: ${error.message}`);
      if (error.stack) {
        channel.appendLine(`  Stack: ${error.stack}`);
      }
    } else {
      channel.appendLine(`  Details: ${String(error)}`);
    }
  }
}

export function logCommand(command: string): void {
  const channel = getOutputChannel();
  const timestamp = new Date().toISOString();
  channel.appendLine(`[${timestamp}] Executing: ${command}`);
}

export function showOutputChannel(): void {
  getOutputChannel().show();
}

export function disposeOutputChannel(): void {
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = undefined;
  }
}
