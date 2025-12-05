import { Language } from "../types";
import * as en from "./en";
import * as ua from "./ua";
import * as zh from "./zh";

const promptModules = { en, ua, zh };

export function createGenerationPrompt(
  diff: string,
  stats: string,
  lang: Language,
  multiLine = false
): string {
  const module = promptModules[lang];
  return module.getGenerationPrompt(diff, stats, multiLine);
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
