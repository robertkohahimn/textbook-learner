import {
  buildDeckPrompt,
  buildRevisePrompt,
  validateDeck,
  validateSlide,
  type DeckOptions,
  type Slide,
} from "./deck";
import { extractJson } from "./json";
import { getLlm } from "./llm";

/** Server-only LLM halves of the deck module (deck.ts stays client-safe). */

export async function generateDeck(
  lesson: { title: string; summary: string | null },
  lessonText: string,
  options: DeckOptions
): Promise<Slide[]> {
  const prompt = buildDeckPrompt(lesson, lessonText, options);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      return validateDeck(extractJson(raw));
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Deck generation failed");
}

export async function reviseSlide(
  lesson: { title: string; summary: string | null },
  lessonText: string,
  deck: Slide[],
  index: number,
  instruction: string
): Promise<Slide> {
  const prompt = buildRevisePrompt(lesson, lessonText, deck, index, instruction);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the slide JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      return validateSlide(extractJson(raw));
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Slide revision failed");
}
