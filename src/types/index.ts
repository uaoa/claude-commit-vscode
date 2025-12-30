import * as vscode from "vscode";

export interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: {
    value: string;
  };
  state: {
    indexChanges: unknown[];
    workingTreeChanges: unknown[];
  };
}

export interface GitAPI {
  repositories: GitRepository[];
  state: {
    selectedRepositoryIndex?: number;
  };
}

export interface DiffResult {
  diff: string;
  stats: string;
}

export interface ClaudeCommitConfig {
  cliPath: string;
  apiKey: string;
  preferredMethod: "auto" | "cli" | "api";
  model: "haiku" | "sonnet" | "opus";
  language: "en" | "ua" | "zh";
  multiLineCommit: boolean;
  diffSource: "staged" | "all" | "auto";
  claudeCodeManaged: boolean;
  keepCoAuthoredBy: boolean;
  commitStyle: "conventional" | "prefix" | "default" | "custom";
  customPromptTemplate: string;
}

export type ProgressCallback = (message: string) => void;

export type Language = "en" | "ua" | "zh";

export type Model = "haiku" | "sonnet" | "opus";

export type GenerationMethod = "auto" | "cli" | "api";

export type DiffSource = "staged" | "all" | "auto";

export type CommitStyle = "conventional" | "prefix" | "default" | "custom";
