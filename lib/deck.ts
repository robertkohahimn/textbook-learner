/**
 * Slide deck schema, validation, and prompts — modeled on NotebookLM's
 * Slide Decks: varied layouts with a narrative arc, speaker notes, per-slide
 * source citations, presenter/detailed formats, length options, a free-form
 * focus prompt, and per-slide grounded revisions.
 *
 * Pure module (no Node APIs) so client components can import it;
 * the LLM-calling halves live in deck-generate.ts.
 */

import { MATH_INSTRUCTION } from "./math";

export type SlideLayout =
  | "title"
  | "section"
  | "bullets"
  | "two-column"
  | "quote"
  | "big-fact"
  | "process"
  | "recap";

export interface SlideColumn {
  heading: string;
  bullets: string[];
}

export interface SlideStep {
  label: string;
  detail: string;
}

export interface Slide {
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  columns?: SlideColumn[];
  quote?: { text: string; attribution?: string };
  fact?: { value: string; label: string };
  steps?: SlideStep[];
  /** Speaker notes — what a presenter would say over this slide. */
  notes: string;
  /** Source page numbers this slide draws from. */
  pages?: number[];
}

export type DeckFormat = "presenter" | "detailed";
export type DeckLength = "short" | "default" | "long";

export interface DeckOptions {
  format: DeckFormat;
  length: DeckLength;
  /** Free-form guidance: audience, tone, what to emphasize. */
  focus?: string;
}

export interface DeckMeta extends DeckOptions {
  generatedAt: string;
}

export const DEFAULT_DECK_OPTIONS: DeckOptions = {
  format: "presenter",
  length: "default",
};

const MAX_SOURCE_CHARS = 28_000;
const MAX_REVISE_SOURCE_CHARS = 14_000;
const MIN_SLIDES = 4;

function fail(message: string): never {
  throw new Error(`Deck invalid: ${message}`);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function cleanBullets(value: unknown, what: string, min = 1): string[] {
  if (!Array.isArray(value) || !value.every((b) => typeof b === "string"))
    fail(`${what} must be an array of strings`);
  const bullets = value.map((b) => b.trim()).filter((b) => b !== "");
  if (bullets.length < min) fail(`${what} needs at least ${min} item(s)`);
  return bullets;
}

function cleanPages(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pages = [
    ...new Set(
      value
        .map((p) => (typeof p === "number" ? Math.round(p) : NaN))
        .filter((p) => Number.isInteger(p) && p > 0)
    ),
  ].sort((a, b) => a - b);
  return pages.length > 0 ? pages : undefined;
}

const LAYOUTS: SlideLayout[] = [
  "title",
  "section",
  "bullets",
  "two-column",
  "quote",
  "big-fact",
  "process",
  "recap",
];

/** Strict validation for one freshly generated slide. */
export function validateSlide(raw: unknown, where = "slide"): Slide {
  if (typeof raw !== "object" || raw === null) fail(`${where} must be an object`);
  const s = raw as Record<string, unknown>;

  const layout = s.layout as SlideLayout;
  if (!LAYOUTS.includes(layout))
    fail(`${where} layout must be one of: ${LAYOUTS.join(", ")}`);

  const title = cleanString(s.title);
  if (!title) fail(`${where} title missing`);

  const slide: Slide = {
    layout,
    title,
    notes: cleanString(s.notes) ?? "",
  };
  const subtitle = cleanString(s.subtitle);
  if (subtitle) slide.subtitle = subtitle;
  const pages = cleanPages(s.pages);
  if (pages) slide.pages = pages;

  switch (layout) {
    case "title":
    case "section":
      break;
    case "bullets":
    case "recap":
      slide.bullets = cleanBullets(s.bullets, `${where} bullets`);
      break;
    case "two-column": {
      const cols = s.columns;
      if (!Array.isArray(cols) || cols.length < 2 || cols.length > 3)
        fail(`${where} needs 2-3 columns`);
      slide.columns = cols.map((c, i) => {
        const col = c as Record<string, unknown>;
        const heading = cleanString(col.heading);
        if (!heading) fail(`${where} column ${i + 1} heading missing`);
        return {
          heading,
          bullets: cleanBullets(col.bullets, `${where} column ${i + 1} bullets`),
        };
      });
      break;
    }
    case "quote": {
      const q = s.quote as Record<string, unknown> | undefined;
      const text = cleanString(q?.text);
      if (!text) fail(`${where} quote text missing`);
      slide.quote = { text };
      const attribution = cleanString(q?.attribution);
      if (attribution) slide.quote.attribution = attribution;
      break;
    }
    case "big-fact": {
      const f = s.fact as Record<string, unknown> | undefined;
      const value = cleanString(f?.value);
      const label = cleanString(f?.label);
      if (!value || !label) fail(`${where} fact needs value and label`);
      slide.fact = { value, label };
      break;
    }
    case "process": {
      const steps = s.steps;
      if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6)
        fail(`${where} needs 2-6 steps`);
      slide.steps = steps.map((st, i) => {
        const step = st as Record<string, unknown>;
        const label = cleanString(step.label);
        if (!label) fail(`${where} step ${i + 1} label missing`);
        return { label, detail: cleanString(step.detail) ?? "" };
      });
      break;
    }
  }
  return slide;
}

/** Validate a full freshly generated deck. */
export function validateDeck(data: unknown): Slide[] {
  const root =
    Array.isArray(data) ? data : (data as { slides?: unknown } | null)?.slides;
  if (!Array.isArray(root) || root.length < MIN_SLIDES)
    fail(`expected at least ${MIN_SLIDES} slides`);
  return root.map((s, i) => validateSlide(s, `slide ${i + 1}`));
}

/**
 * Tolerant normalization for slides already stored in the database,
 * including the legacy { title, bullets } shape from before layouts existed.
 */
export function normalizeSlide(raw: unknown): Slide {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  if (LAYOUTS.includes(s.layout as SlideLayout)) {
    try {
      return validateSlide(s);
    } catch {
      // fall through to the legacy shape
    }
  }
  return {
    layout: "bullets",
    title: cleanString(s.title) ?? "Untitled slide",
    bullets: Array.isArray(s.bullets)
      ? (s.bullets.filter((b) => typeof b === "string") as string[])
      : ["—"],
    notes: cleanString(s.notes) ?? "",
  };
}

/** Parse user-supplied deck options from an API body, applying defaults. */
export function parseDeckOptions(body: unknown): DeckOptions {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const format: DeckFormat =
    b.format === "detailed" || b.format === "presenter"
      ? b.format
      : DEFAULT_DECK_OPTIONS.format;
  const length: DeckLength =
    b.length === "short" || b.length === "long" || b.length === "default"
      ? b.length
      : DEFAULT_DECK_OPTIONS.length;
  const focus = cleanString(b.focus)?.slice(0, 500);
  return focus ? { format, length, focus } : { format, length };
}

/** "p. 3, 12–14" from sorted page numbers, collapsing consecutive runs. */
export function formatPageRefs(pages: number[]): string {
  if (pages.length === 0) return "";
  const runs: string[] = [];
  let start = pages[0];
  let prev = pages[0];
  for (const p of pages.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = p;
  }
  runs.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `p. ${runs.join(", ")}`;
}

function slideCount(length: DeckLength): string {
  if (length === "short") return "6 to 8";
  if (length === "long") return "15 to 20";
  return "10 to 14";
}

function formatRules(format: DeckFormat): string {
  if (format === "detailed") {
    return `FORMAT — detailed deck: this deck will be READ on its own, not presented.
Bullets are complete sentences that fully explain each idea (15-25 words each).
A reader who never opens the book should understand the lesson from the slides alone.`;
  }
  return `FORMAT — presenter slides: this deck supports a live presenter.
Slides carry only key talking points — bullets are short and punchy (at most 10 words each).
The full explanation goes in the speaker notes, not on the slide.`;
}

/**
 * The slide schema and craft rules, shared between full-materials generation
 * and deck-only regeneration so both produce the same deck quality.
 */
export function deckSpec(options: DeckOptions): string {
  return `Create ${slideCount(options.length)} slides that teach the lesson with a clear narrative arc:
- Slide 1 uses layout "title": reframe the lesson title as a compelling hook, with a one-line "subtitle" saying why it matters.
- Body slides teach step by step, building on each other. Use "section" slides as chapter dividers when the lesson has distinct movements.
- The final slide uses layout "recap": the 3 to 5 things a learner must retain.

Slide layouts (vary them — never use the same layout more than twice in a row, and use at least 4 different layouts across the deck):
- "title": { "layout": "title", "title": "...", "subtitle": "...", "notes": "...", "pages": [1] }
- "section": chapter divider. { "layout": "section", "title": "...", "subtitle": "...", "notes": "...", "pages": [2] }
- "bullets": classic points. { "layout": "bullets", "title": "...", "bullets": ["...", "..."], "notes": "...", "pages": [3] } (2 to 4 bullets)
- "two-column": comparison or contrast. { "layout": "two-column", "title": "...", "columns": [{ "heading": "...", "bullets": ["..."] }, { "heading": "...", "bullets": ["..."] }], "notes": "...", "pages": [4] }
- "quote": a striking sentence quoted VERBATIM from the source. { "layout": "quote", "title": "...", "quote": { "text": "...", "attribution": "..." }, "notes": "...", "pages": [5] }
- "big-fact": one number or short claim that deserves a whole slide. { "layout": "big-fact", "title": "...", "fact": { "value": "2", "label": "possible outcomes for every spin measurement" }, "notes": "...", "pages": [6] }
- "process": a sequence, flow, or cause-and-effect chain. { "layout": "process", "title": "...", "steps": [{ "label": "...", "detail": "..." }], "notes": "...", "pages": [7] } (2 to 6 steps)
- "recap": { "layout": "recap", "title": "...", "bullets": ["..."], "notes": "...", "pages": [8] }

Every slide MUST include:
- "notes": speaker notes — 2 to 4 conversational sentences a presenter would actually SAY over this slide, adding context, examples, or transitions beyond what is written on it.
- "pages": the source page numbers this slide draws from, taken from the [p.N] markers in the source text (e.g. [12, 13]).

${MATH_INSTRUCTION}

${formatRules(options.format)}${
    options.focus
      ? `\n\nAUDIENCE & FOCUS (from the learner — honor this throughout):\n${options.focus}`
      : ""
  }`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n[...truncated]" : text;
}

export function buildDeckPrompt(
  lesson: { title: string; summary: string | null },
  lessonText: string,
  options: DeckOptions
): string {
  return `You are an expert presentation designer and teacher preparing a slide deck for one lesson.

LESSON: "${lesson.title}"${lesson.summary ? ` — ${lesson.summary}` : ""}

SOURCE TEXT (from the book, this lesson's pages, with [p.N] page markers):
---
${truncate(lessonText, MAX_SOURCE_CHARS)}
---

Ground every slide ONLY in the source text above.

${deckSpec(options)}

Output ONLY this JSON, no other text:
{ "slides": [ { "layout": "title", "title": "...", "subtitle": "...", "notes": "...", "pages": [1] } ] }`;
}

export function buildRevisePrompt(
  lesson: { title: string; summary: string | null },
  lessonText: string,
  deck: Slide[],
  index: number,
  instruction: string
): string {
  const outline = deck
    .map((s, i) => `${i + 1}. [${s.layout}] ${s.title}${i === index ? "  ← REVISE THIS ONE" : ""}`)
    .join("\n");

  return `You are revising ONE slide in a lesson slide deck.

LESSON: "${lesson.title}"${lesson.summary ? ` — ${lesson.summary}` : ""}

SOURCE TEXT (from the book, with [p.N] page markers — stay grounded in it):
---
${truncate(lessonText, MAX_REVISE_SOURCE_CHARS)}
---

DECK OUTLINE (for context):
${outline}

CURRENT SLIDE ${index + 1} (JSON):
${JSON.stringify(deck[index], null, 2)}

REVISION INSTRUCTION FROM THE LEARNER:
${instruction}

Rewrite this one slide following the instruction. You may change its layout if that serves the instruction. Available layouts and their shapes:
- "title": { "layout": "title", "title", "subtitle"?, "notes", "pages" }
- "section": { "layout": "section", "title", "subtitle"?, "notes", "pages" }
- "bullets" / "recap": { "layout": "bullets", "title", "bullets": [2-4 strings], "notes", "pages" }
- "two-column": { "layout": "two-column", "title", "columns": [{ "heading", "bullets" }, { "heading", "bullets" }], "notes", "pages" }
- "quote": { "layout": "quote", "title", "quote": { "text", "attribution"? }, "notes", "pages" }
- "big-fact": { "layout": "big-fact", "title", "fact": { "value", "label" }, "notes", "pages" }
- "process": { "layout": "process", "title", "steps": [{ "label", "detail" }, ... 2-6 steps], "notes", "pages" }

Keep "notes" (speaker notes, 2-4 spoken sentences) and "pages" (source page numbers from the [p.N] markers) accurate for the revised content.

${MATH_INSTRUCTION}

Output ONLY the revised slide as a single JSON object, no other text.`;
}
