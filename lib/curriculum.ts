import type { CurriculumInput } from "./db";
import type { OutlineItem } from "./pdf";
import { extractJson } from "./json";
import { getLlm } from "./llm";

const EXCERPT_CHARS = 150;

export interface BookInfo {
  title: string;
  author: string | null;
  numPages: number;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Curriculum invalid: ${what} must be a non-empty string`);
  }
  return value.trim();
}

function clampPage(value: unknown, numPages: number): number {
  const n = typeof value === "number" ? Math.round(value) : NaN;
  if (Number.isNaN(n)) throw new Error("Curriculum invalid: page must be a number");
  return Math.min(Math.max(n, 1), numPages);
}

export function validateCurriculum(data: unknown, numPages: number): CurriculumInput[] {
  const root = data as { modules?: unknown };
  if (!root || !Array.isArray(root.modules) || root.modules.length === 0) {
    throw new Error("Curriculum invalid: expected a non-empty modules array");
  }
  return root.modules.map((mod) => {
    const m = mod as Record<string, unknown>;
    const lessons = m.lessons;
    if (!Array.isArray(lessons) || lessons.length === 0) {
      throw new Error("Curriculum invalid: every module needs at least one lesson");
    }
    return {
      title: asString(m.title, "module title"),
      description: typeof m.description === "string" ? m.description : "",
      lessons: lessons.map((lesson) => {
        const l = lesson as Record<string, unknown>;
        let pageStart = clampPage(l.pageStart, numPages);
        let pageEnd = clampPage(l.pageEnd, numPages);
        if (pageStart > pageEnd) [pageStart, pageEnd] = [pageEnd, pageStart];
        return {
          title: asString(l.title, "lesson title"),
          summary: typeof l.summary === "string" ? l.summary : "",
          pageStart,
          pageEnd,
        };
      }),
    };
  });
}

export function buildCurriculumPrompt(
  book: BookInfo,
  pages: string[],
  outline: OutlineItem[]
): string {
  const outlineText =
    outline.length > 0
      ? outline
          .map((o) => `- ${o.title}${o.page ? ` (starts p.${o.page})` : ""}`)
          .join("\n")
      : "(no outline available)";

  const excerpts = pages
    .map((text, i) => `[p.${i + 1}] ${text.slice(0, EXCERPT_CHARS).replace(/\s+/g, " ")}`)
    .join("\n");

  return `You are an expert instructional designer. Design a study curriculum for this book.

BOOK: "${book.title}"${book.author ? ` by ${book.author}` : ""} — ${book.numPages} pages.

TABLE OF CONTENTS (from the book outline):
${outlineText}

PER-PAGE EXCERPTS (first ${EXCERPT_CHARS} characters of each page, for orientation):
${excerpts}

Create a curriculum that takes a motivated beginner through the instructional core of this book.

Rules:
- 3 to 8 modules, each with 2 to 6 lessons.
- Each lesson covers a contiguous page range of roughly 4 to 25 pages.
- Lessons must not overlap and should progress through the book in order.
- Skip front matter (cover, table of contents, acknowledgments) and back matter (index, bibliography).
- Lesson titles should be specific and engaging; summaries one sentence each.
- Use the printed page positions [p.N] above for pageStart/pageEnd (page numbers, 1-based).

Output ONLY this JSON, no other text:
{
  "modules": [
    {
      "title": "Module title",
      "description": "One-sentence module description",
      "lessons": [
        { "title": "Lesson title", "summary": "One-sentence summary", "pageStart": 12, "pageEnd": 28 }
      ]
    }
  ]
}`;
}

export async function generateCurriculum(
  book: BookInfo,
  pages: string[],
  outline: OutlineItem[]
): Promise<CurriculumInput[]> {
  const prompt = buildCurriculumPrompt(book, pages, outline);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      return validateCurriculum(extractJson(raw), book.numPages);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Curriculum generation failed");
}
