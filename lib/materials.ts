import type { LessonMaterials, QuizQuestion, Takeaway } from "./db";
import { DEFAULT_DECK_OPTIONS, DEFAULT_AUDIENCE_LEVEL, deckSpec, validateDeck, type Slide } from "./deck";
import { MATH_INSTRUCTION } from "./math";
import { extractJson } from "./json";
import { getLlm } from "./llm";
import { buildQuizPrompt, validateQuiz, shuffleChoices } from "./quiz";

const MAX_LESSON_CHARS = 28_000;

function fail(message: string): never {
  throw new Error(`Materials invalid: ${message}`);
}

/** Validate the slides + takeaways produced by the first generation call. */
export function validateLessonContent(data: unknown): { slides: Slide[]; takeaways: Takeaway[] } {
  if (typeof data !== "object" || data === null) fail("expected an object");
  const root = data as Record<string, unknown>;

  const slides: Slide[] = validateDeck(root.slides);

  const takeaways = root.takeaways;
  if (!Array.isArray(takeaways) || takeaways.length < 3) fail("need at least 3 takeaways");
  const validTakeaways: Takeaway[] = takeaways.map((t) => {
    const ta = t as Record<string, unknown>;
    if (typeof ta.point !== "string" || ta.point.trim() === "") fail("takeaway point missing");
    return {
      point: ta.point.trim(),
      detail: typeof ta.detail === "string" ? ta.detail : "",
    };
  });

  return { slides, takeaways: validTakeaways };
}

export function buildMaterialsPrompt(
  lesson: { title: string; summary: string | null },
  lessonText: string
): string {
  const text =
    lessonText.length > MAX_LESSON_CHARS
      ? lessonText.slice(0, MAX_LESSON_CHARS) + "\n[...truncated]"
      : lessonText;

  return `You are an expert teacher and presentation designer preparing study materials for one lesson.

LESSON: "${lesson.title}"${lesson.summary ? ` — ${lesson.summary}` : ""}

SOURCE TEXT (from the book, this lesson's pages, with [p.N] page markers):
---
${text}
---

Create study materials grounded ONLY in the source text above.

${MATH_INSTRUCTION} This applies to slides and takeaways alike.

1. slides: a presentation deck. ${deckSpec(DEFAULT_DECK_OPTIONS)}

2. takeaways: 4 to 7 key takeaways. Each has "point" (one bold-able phrase) and "detail" (1-2 sentences of explanation). Pitch every takeaway for ${DEFAULT_AUDIENCE_LEVEL}

Output ONLY this JSON, no other text:
{
  "slides": [ { "layout": "title", "title": "...", "subtitle": "...", "notes": "...", "pages": [1] } ],
  "takeaways": [ { "point": "...", "detail": "..." } ]
}`;
}

async function generateLessonContent(
  lesson: { title: string; summary: string | null },
  lessonText: string
): Promise<{ slides: Slide[]; takeaways: Takeaway[] }> {
  const prompt = buildMaterialsPrompt(lesson, lessonText);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      return validateLessonContent(extractJson(raw));
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Lesson content generation failed");
}

/** Generate the quiz question pool (its own LLM call). */
export async function generateQuiz(
  lesson: { title: string; summary: string | null },
  lessonText: string
): Promise<QuizQuestion[]> {
  const prompt = buildQuizPrompt(lesson, lessonText);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      const parsed = extractJson(raw) as { quiz?: unknown };
      // Shuffle each question's choices so the correct answer is spread across
      // positions — models tend to emit it first, which made every answer "A".
      return validateQuiz(parsed.quiz).map((question) => shuffleChoices(question));
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Quiz generation failed");
}

export async function generateMaterials(
  lesson: { title: string; summary: string | null },
  lessonText: string
): Promise<LessonMaterials> {
  const { slides, takeaways } = await generateLessonContent(lesson, lessonText);
  const quiz = await generateQuiz(lesson, lessonText);
  return { slides, takeaways, quiz };
}
