import { Language } from "../types";
import * as en from "./en";
import * as ua from "./ua";
import * as zh from "./zh";

const promptModules = { en, ua, zh };

export function createGenerationPrompt(
  diff: string,
  stats: string,
  lang: Language,
  multiLine = false,
  commitStyle = "conventional",
  customTemplate?: string
): string {
  // If custom style and template provided, use it
  if (commitStyle === "custom" && customTemplate) {
    return customTemplate
      .replace(/\{diff\}/g, diff.slice(0, 6000))
      .replace(/\{stats\}/g, stats);
  }

  const module = promptModules[lang];
  return module.getGenerationPrompt(diff, stats, multiLine, commitStyle);
}

export function createManagedPrompt(lang: Language, keepCoAuthoredBy: boolean, multiline: boolean, diffSource: string, customPrompt: string): string {
  const module = promptModules[lang];
  return module.getManagedPrompt(keepCoAuthoredBy, multiline, diffSource, customPrompt);
}

export function createEditPrompt(
  currentMessage: string,
  userFeedback: string,
  diff: string,
  stats: string,
  lang: Language
): string {
  const module = promptModules[lang];
  return module.getEditPrompt(currentMessage, userFeedback, diff, stats);
}
