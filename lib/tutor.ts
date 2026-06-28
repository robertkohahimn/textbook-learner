import type { LessonMaterials, TutorMessageRow } from "./db";
import { MATH_INSTRUCTION } from "./math";

const MAX_LESSON_CHARS = 20_000;
const MAX_HISTORY_MESSAGES = 20;

export interface TutorPrompt {
  system: string;
  prompt: string;
}

export function buildTutorPrompt(
  lesson: { title: string; summary: string | null },
  materials: LessonMaterials | undefined,
  lessonText: string,
  history: Pick<TutorMessageRow, "role" | "content">[],
  question: string,
  currentSlide?: { index: number; title: string }
): TutorPrompt {
  const text =
    lessonText.length > MAX_LESSON_CHARS
      ? lessonText.slice(0, MAX_LESSON_CHARS) + "\n[...truncated]"
      : lessonText;

  const takeaways = materials?.takeaways
    .map((t) => `- ${t.point}: ${t.detail}`)
    .join("\n");

  const slideLine = currentSlide
    ? `\nThe student is currently viewing slide ${currentSlide.index + 1}${
        currentSlide.title ? `: "${currentSlide.title}"` : ""
      }. If they say "this", "this slide", or "here", assume they mean that slide unless the conversation says otherwise.\n`
    : "";

  const system = `You are a patient, encouraging tutor helping a student study the lesson "${lesson.title}"${lesson.summary ? ` (${lesson.summary})` : ""}.

LESSON SOURCE TEXT:
---
${text}
---
${takeaways ? `\nKEY TAKEAWAYS:\n${takeaways}\n` : ""}
Ground your answers in the lesson source text above. If the student asks something the lesson doesn't cover, say so briefly, then give a short general answer if you can. Use plain language, short paragraphs, and markdown. Prefer concrete examples from the lesson. Keep answers focused — usually under 200 words unless the student asks for depth.
${slideLine}
${MATH_INSTRUCTION}`;

  const transcript = history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n\n");

  const prompt = transcript
    ? `Conversation so far:\n\n${transcript}\n\nStudent: ${question}\n\nReply as the tutor.`
    : `Student: ${question}\n\nReply as the tutor.`;

  return { system, prompt };
}

export function starterQuestions(materials: LessonMaterials): string[] {
  return materials.takeaways
    .slice(0, 3)
    .map((t) => `Can you explain "${t.point}" in simpler terms?`);
}

/** Validate an untrusted slide-context body into a safe prompt input. */
export function sanitizeSlideContext(
  raw: unknown
): { index: number; title: string } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.index !== "number" || !Number.isInteger(r.index) || r.index < 0)
    return undefined;
  const title = typeof r.title === "string" ? r.title.slice(0, 200) : "";
  return { index: r.index, title };
}
