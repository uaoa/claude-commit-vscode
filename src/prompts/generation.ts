import type { Language } from "../types";
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
  customTemplate?: string,
  tense: "imperative" | "past" = "imperative"
): string {
  if (commitStyle === "custom") {
    const template = (customTemplate ?? "").trim();
    if (!template) {
      throw new Error(
        "Custom commit style is selected but 'claudeCommit.customPromptTemplate' is empty. " +
          "Either fill in the template (use {diff} and {stats} placeholders) or switch commitStyle to 'conventional'."
      );
    }

    const hasDiff = template.includes("{diff}");
    const hasStats = template.includes("{stats}");

    let rendered = template.replace(/\{diff\}/g, diff.slice(0, 6000)).replace(/\{stats\}/g, stats);

    // If the user forgot to include placeholders, append the diff/stats so Claude has context.
    if (!hasDiff && !hasStats) {
      rendered += `\n\nChange statistics:\n${stats}\n\nDiff (first 6000 characters):\n${diff.slice(0, 6000)}`;
    } else if (!hasDiff) {
      rendered += `\n\nDiff (first 6000 characters):\n${diff.slice(0, 6000)}`;
    } else if (!hasStats) {
      rendered += `\n\nChange statistics:\n${stats}`;
    }

    rendered += "\n\nReturn ONLY the commit message, no explanations, no markdown, no code fences.";
    return rendered;
  }

  const module = promptModules[lang];
  return module.getGenerationPrompt(diff, stats, multiLine, commitStyle, tense);
}

export function createManagedPrompt(
  lang: Language,
  diff: string,
  stats: string,
  keepCoAuthoredBy: boolean,
  multiline: boolean,
  customPrompt: string,
  tense: "imperative" | "past" = "imperative"
): { systemPrompt: string; userPrompt: string } {
  const module = promptModules[lang];
  return module.getManagedPrompt(diff, stats, keepCoAuthoredBy, multiline, customPrompt, tense);
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
