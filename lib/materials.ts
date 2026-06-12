import type { LessonMaterials, QuizQuestion, Slide, Takeaway } from "./db";
import { extractJson } from "./json";
import { getLlm } from "./llm";

const MAX_LESSON_CHARS = 28_000;

function fail(message: string): never {
  throw new Error(`Materials invalid: ${message}`);
}

export function validateMaterials(data: unknown): LessonMaterials {
  if (typeof data !== "object" || data === null) fail("expected an object");
  const root = data as Record<string, unknown>;

  const slides = root.slides;
  if (!Array.isArray(slides) || slides.length === 0) fail("slides must be non-empty");
  const validSlides: Slide[] = slides.map((s) => {
    const slide = s as Record<string, unknown>;
    if (typeof slide.title !== "string" || slide.title.trim() === "")
      fail("slide title missing");
    if (
      !Array.isArray(slide.bullets) ||
      slide.bullets.length === 0 ||
      !slide.bullets.every((b) => typeof b === "string")
    )
      fail("slide bullets must be a non-empty string array");
    return { title: slide.title.trim(), bullets: slide.bullets as string[] };
  });

  const takeaways = root.takeaways;
  if (!Array.isArray(takeaways) || takeaways.length < 3)
    fail("need at least 3 takeaways");
  const validTakeaways: Takeaway[] = takeaways.map((t) => {
    const ta = t as Record<string, unknown>;
    if (typeof ta.point !== "string" || ta.point.trim() === "")
      fail("takeaway point missing");
    return {
      point: ta.point.trim(),
      detail: typeof ta.detail === "string" ? ta.detail : "",
    };
  });

  const quiz = root.quiz;
  if (!Array.isArray(quiz) || quiz.length < 3) fail("need at least 3 quiz questions");
  const validQuiz: QuizQuestion[] = quiz.map((q) => {
    const question = q as Record<string, unknown>;
    if (typeof question.question !== "string" || question.question.trim() === "")
      fail("quiz question missing");
    const choices = question.choices;
    if (
      !Array.isArray(choices) ||
      choices.length < 2 ||
      !choices.every((c) => typeof c === "string")
    )
      fail("quiz choices must be 2+ strings");
    const answerIndex = question.answerIndex;
    if (
      typeof answerIndex !== "number" ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= choices.length
    )
      fail("answerIndex out of range");
    return {
      question: question.question.trim(),
      choices: choices as string[],
      answerIndex,
      explanation:
        typeof question.explanation === "string" ? question.explanation : "",
    };
  });

  return { slides: validSlides, takeaways: validTakeaways, quiz: validQuiz };
}

export function buildMaterialsPrompt(
  lesson: { title: string; summary: string | null },
  lessonText: string
): string {
  const text =
    lessonText.length > MAX_LESSON_CHARS
      ? lessonText.slice(0, MAX_LESSON_CHARS) + "\n[...truncated]"
      : lessonText;

  return `You are an expert teacher preparing study materials for one lesson.

LESSON: "${lesson.title}"${lesson.summary ? ` — ${lesson.summary}` : ""}

SOURCE TEXT (from the book, this lesson's pages):
---
${text}
---

Create study materials grounded ONLY in the source text above.

1. slides: 6 to 10 presentation slides that teach the lesson step by step. Each slide has a short punchy title and 2 to 4 bullets (each bullet one clear sentence, plain text).
2. takeaways: 4 to 7 key takeaways. Each has "point" (one bold-able phrase) and "detail" (1-2 sentences of explanation).
3. quiz: exactly 5 multiple-choice questions testing understanding (not trivia). Each has 4 plausible choices, the 0-based "answerIndex" of the correct one, and a 1-2 sentence "explanation" of why it is correct.

Output ONLY this JSON, no other text:
{
  "slides": [ { "title": "...", "bullets": ["...", "..."] } ],
  "takeaways": [ { "point": "...", "detail": "..." } ],
  "quiz": [ { "question": "...", "choices": ["...", "...", "...", "..."], "answerIndex": 0, "explanation": "..." } ]
}`;
}

export async function generateMaterials(
  lesson: { title: string; summary: string | null },
  lessonText: string
): Promise<LessonMaterials> {
  const prompt = buildMaterialsPrompt(lesson, lessonText);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      return validateMaterials(extractJson(raw));
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Materials generation failed");
}
