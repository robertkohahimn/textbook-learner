# Lesson Page Restructure (Reading Rail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the individual lesson page into a two-column reading surface — slides on the left, a persistent right rail with always-visible Notes (editable on the Slides view, a read-only roll-up elsewhere) stacked above a slide-aware Tutor — and fix the highlight-note space-typing bug.

**Architecture:** Lift the current slide `index` and the `useSlideAnnotations` store out of `components/slides.tsx` up to `components/lesson.tsx` so a rail rendered beside every view can follow the current slide. A new `components/lesson-rail.tsx` hosts Notes + Tutor. The Tutor is wrapped in `React.memo` with primitive props so per-keystroke note edits don't re-render an active token stream. Pure logic (roll-up derivation, tutor-prompt slide context, request sanitizing) goes into `lib/` and is unit-tested with vitest; component/hook behavior is verified by typecheck + manual smoke (this repo has no React test harness).

**Tech Stack:** Next.js 16.2.9 (App Router), React 19.2.4, TypeScript 5 (strict), Tailwind CSS v4, vitest 3, better-sqlite3, KaTeX. Spec: `docs/superpowers/specs/2026-06-28-lesson-page-restructure-design.md`.

## Global Constraints

- **Read the Next.js docs before writing code that touches a route/server file.** Per `AGENTS.md`, this is a non-standard Next.js — consult `node_modules/next/dist/docs/` (available only after `npm ci`) for the relevant topic before editing `app/api/.../route.ts`. Heed deprecation notices.
- **Dependencies are not installed.** Run `npm ci` once before anything (Task 0). Package manager is **npm** (`package-lock.json` present).
- **Typecheck command:** `node_modules/.bin/tsc --noEmit -p tsconfig.json` (a global shim hijacks bare `tsc`/`npx tsc`).
- **Test command:** `npm test` (= `vitest run`); single file: `npx vitest run tests/<file>`.
- **Full build (also typechecks):** `npm run build`.
- **Path alias:** `@/*` → repo root (e.g. `@/lib/annotations`).
- **TypeScript is `strict`** — no implicit `any`, handle `undefined`.
- **Rail defaults to open.** Persist open/closed in `localStorage` under the exact key `folio:lesson-rail-open` (`"1"`/`"0"`), global (not per-lesson).
- **Tutor tab is removed** from the top tabs; tabs become exactly `Slides · Takeaways · Quiz`.
- **Slide-context title** sent to the tutor must be truncated to **200 chars** and validated server-side.
- Match existing code style: double quotes, 2-space indent, `cursor-pointer` on interactive elements, `text-ink*/accent/paper/line` Tailwind tokens already in the codebase.
- Commit after every task. Keep the build green at every commit.

---

## File Structure

- `components/lesson.tsx` — **modify.** Owns `index`, `focusId`, `railOpen`, and `annos = useSlideAnnotations(lessonId)`; renders the 2-column grid; removes the Tutor tab; renders `LessonRail`.
- `components/lesson-rail.tsx` — **create.** The stacked Notes + Tutor rail; collapse control; chooses editable `AnnotationPanel` vs `NotesRollup` by active tab; wraps `Tutor` in `React.memo`.
- `components/slides.tsx` — **modify.** Becomes a controlled component (`index`/`onIndexChange`/`annos`/`focusId`/`onPickHighlight` as props); loses its internal slide state, the in-slide `AnnotationPanel`, the "Annotate" button, and `annotateOpen`.
- `components/slide-annotations.tsx` — **modify.** `setHighlightNote` raw-store fix; `AnnotationPanel` gains a slide-number label, always-on empty state, and a `focusId` scroll effect; new `NotesRollup` component; export a `SlideAnnotations` type alias.
- `components/tutor.tsx` — **modify.** Primitive `slideIndex`/`slideTitle` props; sends `slideContext`; layout converted to fill the rail.
- `lib/annotations.ts` — **modify.** Add `RollupEntry` + pure `rollupEntries(...)`.
- `lib/tutor.ts` — **modify.** `buildTutorPrompt` optional `currentSlide`; new pure `sanitizeSlideContext(...)`.
- `app/api/lessons/[lessonId]/tutor/route.ts` — **modify.** Parse/validate `slideContext`, thread it into `buildTutorPrompt`.
- `tests/annotations.test.ts` — **modify.** Tests for `rollupEntries`.
- `tests/tutor.test.ts` — **create.** Tests for `buildTutorPrompt` slide line + `sanitizeSlideContext`.

---

## Task 0: Environment setup & baseline

**Files:** none (setup only).

- [ ] **Step 1: Install dependencies**

Run: `npm ci`
Expected: completes; a `node_modules/` directory now exists.

- [ ] **Step 2: Confirm the baseline test suite is green**

Run: `npm test`
Expected: all existing test files pass (`tests/annotations.test.ts`, `tests/deck.test.ts`, …). This is the baseline you must not regress.

- [ ] **Step 3: Confirm typecheck works via the local binary**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0. (If bare `tsc` prints "This is not the tsc command you are looking for", that's the global shim — always use the `node_modules/.bin/tsc` path.)

- [ ] **Step 4: Read the Next.js route-handler doc (per AGENTS.md)**

Before Task 4 you will edit an API route. Locate and skim the relevant guide now:
Run: `ls node_modules/next/dist/docs/ && find node_modules/next/dist/docs -iname '*rout*' -o -iname '*api*' | head`
Read the route-handler / request guide it points to. Note any deprecations affecting `Request`/`NextResponse`/`params`.

No commit (no file changes).

---

## Task 1: Fix highlight-note space-typing bug

**Files:**
- Modify: `components/slide-annotations.tsx` (the `setHighlightNote` callback, ~lines 310-320)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change — `setHighlightNote(i, id, note)` still `(number, string, string) => void`. Behavior change only: it no longer trims on each keystroke.

**Why:** The `<input>` rendering a highlight note is controlled by `value={h.note ?? ""}`. Storing `note.trim() || undefined` on every keystroke strips a leading/trailing space the instant it's typed, so the space "does nothing." The per-slide note path (`setSlideNote`) already stores raw; this aligns the two. Trimming still happens server-side in `validateSlideAnnotation`.

- [ ] **Step 1: Make the change**

In `components/slide-annotations.tsx`, replace this block:

```tsx
    setHighlightNote: (i: number, id: string, note: string) =>
      update(
        i,
        (a) => ({
          ...a,
          highlights: a.highlights.map((h) =>
            h.id === id ? { ...h, note: note.trim() || undefined } : h
          ),
        }),
        true
      ),
```

with:

```tsx
    setHighlightNote: (i: number, id: string, note: string) =>
      update(
        i,
        (a) => ({
          ...a,
          // Store the raw string so spaces type normally; the server trims on
          // save (validateSlideAnnotation), like the per-slide note path.
          highlights: a.highlights.map((h) =>
            h.id === id ? { ...h, note } : h
          ),
        }),
        true
      ),
```

- [ ] **Step 2: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0. (`Highlight.note` is `string | undefined`; assigning a `string` is valid.)

- [ ] **Step 3: Confirm existing tests still pass**

Run: `npm test`
Expected: all pass — `validateSlideAnnotation` still trims notes on save, so `tests/annotations.test.ts` is unaffected.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open a ready lesson's Slides view, select text → "Highlight" → in the highlight's note input type `"a b c "`. The spaces (including mid- and trailing) must appear and persist while typing. (No automated hook test exists in this repo; this is the gate.)

- [ ] **Step 5: Commit**

```bash
git add components/slide-annotations.tsx
git commit -m "Fix: highlight-note input swallowed spaces (stop trimming per keystroke)"
```

---

## Task 2: Pure `rollupEntries` helper (TDD)

**Files:**
- Modify: `lib/annotations.ts` (add type + function)
- Test: `tests/annotations.test.ts` (add a `describe`)

**Interfaces:**
- Consumes: `SlideAnnotation`, `Highlight` (already in `lib/annotations.ts`).
- Produces:
  ```ts
  interface RollupEntry { index: number; title: string; note: string; highlights: Highlight[]; }
  function rollupEntries(
    annotations: Record<number, SlideAnnotation>,
    slides: { title: string }[]
  ): RollupEntry[]
  ```
  Returns, sorted ascending by `index`, one entry per slide whose annotation has a non-blank note OR ≥1 highlight. `title` falls back to `"Slide N"` when the slide is missing.

- [ ] **Step 1: Write the failing tests**

Append to `tests/annotations.test.ts`:

```ts
import { rollupEntries, type SlideAnnotation } from "@/lib/annotations";

describe("rollupEntries", () => {
  const slides = [{ title: "Intro" }, { title: "Body" }, { title: "End" }];
  const ann = (over: Partial<SlideAnnotation>): SlideAnnotation => ({
    note: "",
    highlights: [],
    ...over,
  });

  it("returns [] when nothing is annotated", () => {
    expect(rollupEntries({}, slides)).toEqual([]);
  });

  it("skips annotations that are blank-note and have no highlights", () => {
    expect(rollupEntries({ 0: ann({ note: "   " }) }, slides)).toEqual([]);
  });

  it("includes a note-only slide", () => {
    expect(rollupEntries({ 1: ann({ note: "hi" }) }, slides)).toEqual([
      { index: 1, title: "Body", note: "hi", highlights: [] },
    ]);
  });

  it("includes a highlight-only slide and sorts by index", () => {
    const h = { id: "x", field: "title", start: 0, end: 2, quote: "In" };
    const out = rollupEntries(
      { 2: ann({ note: "z" }), 0: ann({ highlights: [h] }) },
      slides
    );
    expect(out.map((e) => e.index)).toEqual([0, 2]);
    expect(out[0]).toEqual({ index: 0, title: "Intro", note: "", highlights: [h] });
  });

  it("falls back to 'Slide N' when the slide is missing", () => {
    expect(rollupEntries({ 5: ann({ note: "orphan" }) }, slides)).toEqual([
      { index: 5, title: "Slide 6", note: "orphan", highlights: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/annotations.test.ts`
Expected: FAIL — `rollupEntries` is not exported.

- [ ] **Step 3: Implement the helper**

In `lib/annotations.ts`, after `buildFieldPieces` (before `validateSlideAnnotation`), add:

```ts
export interface RollupEntry {
  index: number;
  title: string;
  note: string;
  highlights: Highlight[];
}

/**
 * Slides that carry user annotations, for the read-only rail roll-up shown off
 * the Slides view. Includes a slide if it has a non-blank note or any highlight.
 */
export function rollupEntries(
  annotations: Record<number, SlideAnnotation>,
  slides: { title: string }[]
): RollupEntry[] {
  const out: RollupEntry[] = [];
  for (const key of Object.keys(annotations)) {
    const index = Number(key);
    const ann = annotations[index];
    if (!ann) continue;
    if (ann.note.trim().length === 0 && ann.highlights.length === 0) continue;
    out.push({
      index,
      title: slides[index]?.title ?? `Slide ${index + 1}`,
      note: ann.note,
      highlights: ann.highlights,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/annotations.test.ts`
Expected: PASS (all `rollupEntries` cases + the existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/annotations.ts tests/annotations.test.ts
git commit -m "Add rollupEntries: derive the rail's read-only notes summary"
```

---

## Task 3: Tutor prompt slide context + request sanitizer (TDD)

**Files:**
- Modify: `lib/tutor.ts` (`buildTutorPrompt` gains a param; add `sanitizeSlideContext`)
- Test: `tests/tutor.test.ts` (create)

**Interfaces:**
- Consumes: existing `buildTutorPrompt(lesson, materials, lessonText, history, question)`.
- Produces:
  ```ts
  // buildTutorPrompt gains an OPTIONAL 6th param (existing callers unaffected):
  buildTutorPrompt(
    lesson: { title: string; summary: string | null },
    materials: LessonMaterials | undefined,
    lessonText: string,
    history: Pick<TutorMessageRow, "role" | "content">[],
    question: string,
    currentSlide?: { index: number; title: string }
  ): TutorPrompt

  function sanitizeSlideContext(raw: unknown): { index: number; title: string } | undefined
  ```
  When `currentSlide` is present, the system prompt gains one line naming the slide. `sanitizeSlideContext` returns `undefined` unless `index` is a non-negative integer; `title` is coerced to a string and truncated to 200 chars.

- [ ] **Step 1: Write the failing tests**

Create `tests/tutor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTutorPrompt, sanitizeSlideContext } from "@/lib/tutor";

const lesson = { title: "Photosynthesis", summary: null };

describe("buildTutorPrompt currentSlide", () => {
  it("omits the slide line when no currentSlide is given", () => {
    const { system } = buildTutorPrompt(lesson, undefined, "text", [], "q?");
    expect(system).not.toMatch(/currently viewing slide/i);
  });

  it("adds a 1-based slide line with the title when given", () => {
    const { system } = buildTutorPrompt(lesson, undefined, "text", [], "q?", {
      index: 2,
      title: "Light reactions",
    });
    expect(system).toContain('currently viewing slide 3: "Light reactions"');
  });

  it("adds the slide number without a quote when the title is empty", () => {
    const { system } = buildTutorPrompt(lesson, undefined, "text", [], "q?", {
      index: 0,
      title: "",
    });
    expect(system).toMatch(/currently viewing slide 1\./);
  });
});

describe("sanitizeSlideContext", () => {
  it("rejects non-objects and bad indices", () => {
    expect(sanitizeSlideContext(undefined)).toBeUndefined();
    expect(sanitizeSlideContext({ index: -1, title: "x" })).toBeUndefined();
    expect(sanitizeSlideContext({ index: 1.5, title: "x" })).toBeUndefined();
    expect(sanitizeSlideContext({ title: "x" })).toBeUndefined();
  });

  it("accepts a valid context and coerces a missing title to ''", () => {
    expect(sanitizeSlideContext({ index: 4 })).toEqual({ index: 4, title: "" });
  });

  it("truncates the title to 200 chars", () => {
    const long = "z".repeat(500);
    const out = sanitizeSlideContext({ index: 0, title: long });
    expect(out?.title.length).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tutor.test.ts`
Expected: FAIL — `sanitizeSlideContext` not exported; slide line absent.

- [ ] **Step 3: Implement in `lib/tutor.ts`**

Change the `buildTutorPrompt` signature to accept the optional param:

```ts
export function buildTutorPrompt(
  lesson: { title: string; summary: string | null },
  materials: LessonMaterials | undefined,
  lessonText: string,
  history: Pick<TutorMessageRow, "role" | "content">[],
  question: string,
  currentSlide?: { index: number; title: string }
): TutorPrompt {
```

Immediately before the `const system = ...` template, add:

```ts
  const slideLine = currentSlide
    ? `\nThe student is currently viewing slide ${currentSlide.index + 1}${
        currentSlide.title ? `: "${currentSlide.title}"` : ""
      }. If they say "this", "this slide", or "here", assume they mean that slide unless the conversation says otherwise.\n`
    : "";
```

Then insert `${slideLine}` into the system template — put it on its own line right before the `${MATH_INSTRUCTION}` line:

```ts
Ground your answers in the lesson source text above. If the student asks something the lesson doesn't cover, say so briefly, then give a short general answer if you can. Use plain language, short paragraphs, and markdown. Prefer concrete examples from the lesson. Keep answers focused — usually under 200 words unless the student asks for depth.
${slideLine}
${MATH_INSTRUCTION}`;
```

At the end of the file, add the sanitizer:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tutor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tutor.ts tests/tutor.test.ts
git commit -m "Tutor prompt: optional current-slide context + request sanitizer"
```

---

## Task 4: Wire the tutor route to slide context

**Files:**
- Modify: `app/api/lessons/[lessonId]/tutor/route.ts`

**Interfaces:**
- Consumes: `buildTutorPrompt(..., currentSlide?)` and `sanitizeSlideContext` from Task 3.
- Produces: the `POST` handler now reads `body.slideContext` and forwards the sanitized value. Request/response shape is otherwise unchanged; `slideContext` is optional, so existing clients keep working.

**Note (AGENTS.md):** you reviewed the Next route-handler doc in Task 0. The only change here is reading an extra JSON field from the same `await req.json()` — no new Next API surface.

- [ ] **Step 1: Update the import**

In `app/api/lessons/[lessonId]/tutor/route.ts`, change:

```ts
import { buildTutorPrompt, starterQuestions } from "@/lib/tutor";
```

to:

```ts
import { buildTutorPrompt, sanitizeSlideContext, starterQuestions } from "@/lib/tutor";
```

- [ ] **Step 2: Parse the slide context in `POST`**

Replace:

```ts
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = body.question?.trim();
```

with:

```ts
  const body = (await req.json().catch(() => ({}))) as {
    question?: string;
    slideContext?: unknown;
  };
  const question = body.question?.trim();
  const currentSlide = sanitizeSlideContext(body.slideContext);
```

- [ ] **Step 3: Pass it to `buildTutorPrompt`**

Replace:

```ts
  const { system, prompt } = buildTutorPrompt(
    { title: lesson.title, summary: lesson.summary },
    materials,
    lessonText,
    history,
    question
  );
```

with:

```ts
  const { system, prompt } = buildTutorPrompt(
    { title: lesson.title, summary: lesson.summary },
    materials,
    lessonText,
    history,
    question,
    currentSlide
  );
```

- [ ] **Step 4: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/api/lessons/[lessonId]/tutor/route.ts
git commit -m "Tutor route: accept and validate slideContext"
```

---

## Task 5: Lift slide state to `Lesson`; make `Slides` controlled (no UX change)

This task changes *ownership* only. The single-column layout, the Tutor tab, and the in-slide notes panel all still render and behave exactly as before — they just read lifted state. This keeps the build green and gives a clean checkpoint before the rail lands.

**Files:**
- Modify: `components/slide-annotations.tsx` (export a type alias)
- Modify: `components/slides.tsx` (consume props instead of local state)
- Modify: `components/lesson.tsx` (own the state, pass it down)

**Interfaces:**
- Produces from `slide-annotations.tsx`:
  ```ts
  type SlideAnnotations = ReturnType<typeof useSlideAnnotations>;
  ```
- `Slides` new props (added to its existing ones):
  ```ts
  index: number;
  onIndexChange: React.Dispatch<React.SetStateAction<number>>;
  annos: SlideAnnotations;
  focusId: string | null;
  onPickHighlight: (id: string) => void;
  ```
  and it **removes** internal `index`, internal `annos = useSlideAnnotations(...)`, and internal `focusId`.

- [ ] **Step 1: Export the annotations type**

In `components/slide-annotations.tsx`, immediately after the `export function useSlideAnnotations(...)` block closes (after its `return { ... };` and closing `}`), add:

```ts
export type SlideAnnotations = ReturnType<typeof useSlideAnnotations>;
```

- [ ] **Step 2: Update `Slides` props and drop lifted local state**

In `components/slides.tsx`:

Update the import to also pull the type:

```tsx
import {
  AnnotationPanel,
  captureFieldSelection,
  Highlightable,
  useSlideAnnotations,
  type FieldSelection,
  type SlideAnnotations,
} from "./slide-annotations";
```

Change the component signature/props from:

```tsx
export function Slides({
  lessonId,
  slides,
  deckMeta,
  lessonTitle,
  onDeckChange,
}: {
  lessonId: string;
  slides: Slide[];
  deckMeta: DeckMeta | null;
  lessonTitle: string;
  onDeckChange: () => void;
}) {
  const [index, setIndex] = useState(0);
```

to:

```tsx
export function Slides({
  lessonId,
  slides,
  deckMeta,
  lessonTitle,
  onDeckChange,
  index,
  onIndexChange,
  annos,
  focusId,
  onPickHighlight,
}: {
  lessonId: string;
  slides: Slide[];
  deckMeta: DeckMeta | null;
  lessonTitle: string;
  onDeckChange: () => void;
  index: number;
  onIndexChange: React.Dispatch<React.SetStateAction<number>>;
  annos: SlideAnnotations;
  focusId: string | null;
  onPickHighlight: (id: string) => void;
}) {
```

Delete these now-lifted local state lines:

```tsx
  const [index, setIndex] = useState(0);     // already removed above via signature change
  const [focusId, setFocusId] = useState<string | null>(null);
  const annos = useSlideAnnotations(lessonId);
```

(Keep `view`, `showNotes`, `presenting`, `exportOpen`, `customizeOpen`, `reviseOpen`, `annotateOpen`, `selection`, `stageRef`, `presentRef`.)

- [ ] **Step 3: Repoint `setIndex` and `setFocusId` usages**

In `components/slides.tsx`, replace every `setIndex(` with `onIndexChange(` (in `prev`, `next`, the grid-thumbnail click, the slide-dot click, and the `CustomizePanel.onDone` `setIndex(0)`). The functional-update forms still work because `onIndexChange` is the same dispatch type.

Update `pickHighlight` from:

```tsx
  const pickHighlight = useCallback((id: string) => {
    setAnnotateOpen(true);
    setFocusId(id);
    setTimeout(() => {
      document
        .getElementById(`hl-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
  }, []);
```

to:

```tsx
  const pickHighlight = useCallback(
    (id: string) => {
      setAnnotateOpen(true);
      onPickHighlight(id);
      setTimeout(() => {
        document
          .getElementById(`hl-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 60);
    },
    [onPickHighlight]
  );
```

In `addHighlightFromSelection`, replace the final `setAnnotateOpen(true);` line with both keeping the panel open and notifying the parent:

```tsx
    annos.addHighlight(safeIndex, hl);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setAnnotateOpen(true);
    onPickHighlight(hl.id);
```

- [ ] **Step 4: Move the clamp-on-shrink effect out of `Slides`**

Delete this effect from `components/slides.tsx`:

```tsx
  // A regenerated deck may be shorter than where the reader was.
  useEffect(() => {
    setIndex((i) => Math.min(i, slides.length - 1));
  }, [slides.length]);
```

(It is re-added in `Lesson` in Step 6. The `AnnotationPanel` block, the "Annotate" button, and `annotateOpen` all stay for now — they are removed in Task 6.)

- [ ] **Step 5: Own the state in `Lesson` and pass it to `Slides`**

In `components/lesson.tsx`, update the import:

```tsx
import { Slides } from "./slides";
```

stays, and add:

```tsx
import { useSlideAnnotations } from "./slide-annotations";
```

Inside `export function Lesson(...)`, add state next to the existing `useState` calls:

```tsx
  const [index, setIndex] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const annos = useSlideAnnotations(lessonId);
```

Add the clamp effect (after the existing effects, guarded on materials):

```tsx
  // A regenerated deck may be shorter than where the reader was.
  const slideCount = data?.materials?.slides.length ?? 0;
  useEffect(() => {
    if (slideCount > 0) setIndex((i) => Math.min(i, slideCount - 1));
  }, [slideCount]);
```

Add a pick handler (rail-open behavior is added in Task 7):

```tsx
  const pickHighlight = (id: string) => setFocusId(id);
```

Update the `<Slides .../>` render to pass the new props:

```tsx
            {tab === "slides" && (
              <Slides
                lessonId={lessonId}
                slides={data.materials!.slides}
                deckMeta={data.deckMeta}
                lessonTitle={lesson.title}
                onDeckChange={() => void refresh()}
                index={index}
                onIndexChange={setIndex}
                annos={annos}
                focusId={focusId}
                onPickHighlight={pickHighlight}
              />
            )}
```

- [ ] **Step 6: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0. (If it complains `index` is declared but unused in `Slides`, ensure Step 2 removed the local `useState` and the prop is wired.)

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Manual smoke**

`npm run dev`, open a ready lesson: slides navigate (arrows, dots, grid), highlighting still opens the in-slide notes panel and focuses the new highlight, "Customize"/"Revise" still reset annotations. Behavior should be identical to before this task.

- [ ] **Step 9: Commit**

```bash
git add components/slide-annotations.tsx components/slides.tsx components/lesson.tsx
git commit -m "Lift slide index + annotations store from Slides up to Lesson"
```

---

## Task 6: Two-column layout + `LessonRail` (Notes + Tutor)

This is the core integration: introduce the grid + rail, move Notes into the rail (editable on Slides, roll-up elsewhere), put the Tutor in the rail (memoized, fill layout, slide-aware), and remove the Tutor top tab and the in-slide notes UI.

**Files:**
- Modify: `components/tutor.tsx` (primitive props, slideContext, fill layout)
- Modify: `components/slide-annotations.tsx` (`AnnotationPanel` label + empty state + scroll effect; new `NotesRollup`)
- Create: `components/lesson-rail.tsx`
- Modify: `components/slides.tsx` (remove in-slide notes UI)
- Modify: `components/lesson.tsx` (grid, remove Tutor tab, render rail)

**Interfaces:**
- `Tutor` new props (replace `lessonId`-only):
  ```ts
  { lessonId: string; slideIndex: number; slideTitle: string }
  ```
- `AnnotationPanel` gains `slideNumber: number`.
- New `NotesRollup`:
  ```ts
  function NotesRollup(props: {
    annotations: Record<number, SlideAnnotation>;
    slides: { title: string }[];
    onJump: (index: number) => void;
  }): JSX.Element
  ```
- New `LessonRail`:
  ```ts
  function LessonRail(props: {
    tab: "slides" | "takeaways" | "quiz";
    lessonId: string;
    slides: Slide[];
    safeIndex: number;
    annos: SlideAnnotations;
    focusId: string | null;
    onJump: (index: number) => void;
  }): JSX.Element
  ```

- [ ] **Step 1: Convert `Tutor` to primitive props + fill layout + slideContext**

In `components/tutor.tsx`, change the signature:

```tsx
export function Tutor({ lessonId }: { lessonId: string }) {
```

to:

```tsx
export function Tutor({
  lessonId,
  slideIndex,
  slideTitle,
}: {
  lessonId: string;
  slideIndex: number;
  slideTitle: string;
}) {
```

In `send`, include the slide context in the POST body — change:

```tsx
      const res = await fetch(`/api/lessons/${lessonId}/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
```

to:

```tsx
      const res = await fetch(`/api/lessons/${lessonId}/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          slideContext: { index: slideIndex, title: slideTitle },
        }),
      });
```

Convert the layout to fill its container. Change the outer wrapper from:

```tsx
    <div className="fade flex flex-col max-w-2xl">
      <div className="space-y-5 min-h-[10rem]">
```

to:

```tsx
    <div className="fade flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 space-y-5 overflow-y-auto pr-1">
```

And change the form from a page-sticky footer:

```tsx
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="sticky bottom-0 mt-6 bg-paper pb-6 pt-2"
      >
```

to a flex-pinned footer:

```tsx
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="mt-3 shrink-0 bg-paper pt-2"
      >
```

(The existing `bottomRef.scrollIntoView({ block: "end" })` autoscroll still works against the new internal scroll container.)

- [ ] **Step 2: Enhance `AnnotationPanel` (label, empty state, scroll effect)**

In `components/slide-annotations.tsx`, ensure `useEffect` is imported (it already is). Change the `AnnotationPanel` signature to accept `slideNumber`:

```tsx
export function AnnotationPanel({
  annotation,
  focusId,
  slideNumber,
  onNoteChange,
  onHighlightNote,
  onRemove,
}: {
  annotation: SlideAnnotation;
  focusId: string | null;
  slideNumber: number;
  onNoteChange: (note: string) => void;
  onHighlightNote: (id: string, note: string) => void;
  onRemove: (id: string) => void;
}) {
```

At the top of the function body (before `return`), add the scroll-to-focus effect (this replaces the `setTimeout` that lived in `Slides`):

```tsx
  useEffect(() => {
    if (!focusId) return;
    document
      .getElementById(`hl-${focusId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusId]);
```

Change the header label from:

```tsx
      <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">Your notes</p>
```

to:

```tsx
      <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
        Your notes · Slide {slideNumber}
      </p>
```

After the `<textarea>` and before the `{annotation.highlights.length > 0 && (` block, add an empty-state hint:

```tsx
      {annotation.highlights.length === 0 && (
        <p className="mt-2 text-xs text-ink-faint">
          Select text on a slide to highlight it.
        </p>
      )}
```

- [ ] **Step 3: Add `NotesRollup` to `slide-annotations.tsx`**

Add the import of the helper at the top of `components/slide-annotations.tsx` (extend the existing `@/lib/annotations` import):

```tsx
import {
  buildFieldPieces,
  emptyAnnotation,
  rollupEntries,
  type Highlight,
  type SlideAnnotation,
} from "@/lib/annotations";
```

At the end of the file, add:

```tsx
/* ---------------- read-only roll-up (off the Slides view) ---------------- */

export function NotesRollup({
  annotations,
  slides,
  onJump,
}: {
  annotations: Record<number, SlideAnnotation>;
  slides: { title: string }[];
  onJump: (index: number) => void;
}) {
  const entries = rollupEntries(annotations, slides);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        No notes yet. Open the Slides tab and select text to highlight, or jot a
        note.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {entries.map((e) => (
        <li key={e.index}>
          <button
            type="button"
            onClick={() => onJump(e.index)}
            className="w-full rounded-lg border border-line-soft px-3 py-2.5 text-left transition-colors hover:border-accent cursor-pointer"
          >
            <p className="font-mono text-[11px] text-ink-faint">
              Slide {e.index + 1} · {e.title}
            </p>
            {e.note.trim() && (
              <p className="mt-1 text-sm leading-snug text-ink-soft">{e.note}</p>
            )}
            {e.highlights.map((h) => (
              <p key={h.id} className="mt-1.5 text-sm leading-snug">
                <span className="anno-mark rounded px-1">{h.quote}</span>
                {h.note && (
                  <span className="mt-0.5 block text-xs text-ink-soft">{h.note}</span>
                )}
              </p>
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Create `components/lesson-rail.tsx`**

```tsx
"use client";

import { memo } from "react";
import type { Slide } from "@/lib/deck";
import {
  AnnotationPanel,
  NotesRollup,
  type SlideAnnotations,
} from "./slide-annotations";
import { Tutor } from "./tutor";
import { emptyAnnotation } from "@/lib/annotations";

// Memoized so per-keystroke note edits in the rail (which re-render LessonRail)
// do not re-render an actively streaming tutor. Props are primitives that stay
// stable across note edits, so the shallow compare holds.
const TutorPanel = memo(Tutor);

export function LessonRail({
  tab,
  lessonId,
  slides,
  safeIndex,
  annos,
  focusId,
  onJump,
}: {
  tab: "slides" | "takeaways" | "quiz";
  lessonId: string;
  slides: Slide[];
  safeIndex: number;
  annos: SlideAnnotations;
  focusId: string | null;
  onJump: (index: number) => void;
}) {
  const ann = annos.annotations[safeIndex] ?? emptyAnnotation();

  return (
    <aside className="mt-8 flex flex-col gap-4 lg:sticky lg:top-0 lg:mt-0 lg:h-[100dvh] lg:py-6 print:hidden">
      <section className="rounded-xl border border-line bg-paper-raised px-4 py-3 lg:max-h-[45%] lg:overflow-y-auto">
        {tab === "slides" ? (
          <AnnotationPanel
            annotation={ann}
            focusId={focusId}
            slideNumber={safeIndex + 1}
            onNoteChange={(note) => annos.setSlideNote(safeIndex, note)}
            onHighlightNote={(id, note) =>
              annos.setHighlightNote(safeIndex, id, note)
            }
            onRemove={(id) => annos.removeHighlight(safeIndex, id)}
          />
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
              Your notes
            </p>
            <div className="mt-2">
              <NotesRollup
                annotations={annos.annotations}
                slides={slides}
                onJump={onJump}
              />
            </div>
          </>
        )}
      </section>

      <section className="flex min-h-[60vh] flex-1 flex-col rounded-xl border border-line bg-paper-raised px-4 py-3 lg:min-h-0">
        <p className="mb-2 shrink-0 text-xs uppercase tracking-[0.2em] text-ink-faint">
          Tutor
        </p>
        <TutorPanel
          lessonId={lessonId}
          slideIndex={safeIndex}
          slideTitle={slides[safeIndex]?.title ?? ""}
        />
      </section>
    </aside>
  );
}
```

Note: the editable `AnnotationPanel` already renders its own "Your notes · Slide N" header, so the Slides branch does not add a second header; the roll-up branch supplies its own "Your notes" header.

- [ ] **Step 5: Remove the in-slide notes UI from `Slides`**

In `components/slides.tsx`:

Remove `AnnotationPanel` from the import (keep the rest):

```tsx
import {
  captureFieldSelection,
  Highlightable,
  useSlideAnnotations,
  type FieldSelection,
  type SlideAnnotations,
} from "./slide-annotations";
```

Delete the `annotateOpen` state line:

```tsx
  const [annotateOpen, setAnnotateOpen] = useState(false);
```

Delete the "Annotate" toolbar button block:

```tsx
          <ToolButton
            onClick={() => setAnnotateOpen((v) => !v)}
            active={annotateOpen}
            title="Highlights & your notes"
          >
            Annotate
            {(ann.highlights.length > 0 || ann.note) && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />
            )}
          </ToolButton>
```

Delete the `AnnotationPanel` render block:

```tsx
          {annotateOpen && (
            <AnnotationPanel
              annotation={ann}
              focusId={focusId}
              onNoteChange={(note) => annos.setSlideNote(safeIndex, note)}
              onHighlightNote={(id, note) =>
                annos.setHighlightNote(safeIndex, id, note)
              }
              onRemove={(id) => annos.removeHighlight(safeIndex, id)}
            />
          )}
```

Simplify `pickHighlight` (the scroll now lives in `AnnotationPanel`) and the `setAnnotateOpen` calls:

```tsx
  const pickHighlight = useCallback(
    (id: string) => onPickHighlight(id),
    [onPickHighlight]
  );
```

In `addHighlightFromSelection`, remove the now-deleted `setAnnotateOpen(true);` line, leaving:

```tsx
    annos.addHighlight(safeIndex, hl);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    onPickHighlight(hl.id);
```

`focusId` is still a prop but no longer read inside `Slides` — remove `focusId` from the `Slides` destructured props and its type (it now lives only in the rail). The `Stage`'s `onPick={pickHighlight}` is unchanged. `ann` is still used (passed to `Stage` as `highlights={ann.highlights}`), so keep the `const ann = ...` line.

- [ ] **Step 6: Drop `focusId` from the `Slides` call and render the grid + rail in `Lesson`**

In `components/lesson.tsx`:

Remove the `Tutor` import and tab. Delete:

```tsx
import { Tutor } from "./tutor";
```

Change the `TABS` array to drop tutor:

```tsx
const TABS = [
  { key: "slides", label: "Slides" },
  { key: "takeaways", label: "Takeaways" },
  { key: "quiz", label: "Quiz" },
] as const;
```

Add the rail import:

```tsx
import { LessonRail } from "./lesson-rail";
```

Add a `safeIndex` and an `onJump` near the other handlers:

```tsx
  const safeIndex = Math.max(0, Math.min(index, slideCount - 1));
  const onJump = (i: number) => {
    switchTab("slides");
    setIndex(i);
    const first = data?.materials?.slides
      ? (annos.annotations[i]?.highlights[0]?.id ?? null)
      : null;
    setFocusId(first);
  };
```

(Place these after `slideCount` is defined in Task 5 Step 5. `switchTab` is the existing function.)

Remove `focusId` from the `<Slides .../>` props (it's no longer a Slides prop):

```tsx
            {tab === "slides" && (
              <Slides
                lessonId={lessonId}
                slides={data.materials!.slides}
                deckMeta={data.deckMeta}
                lessonTitle={lesson.title}
                onDeckChange={() => void refresh()}
                index={index}
                onIndexChange={setIndex}
                annos={annos}
                onPickHighlight={pickHighlight}
              />
            )}
```

Now wrap the tab nav + content + rail in a 2-column grid. Replace the entire `ready` branch — from `<nav ...>` through the closing of the content `</section>` — with:

```tsx
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0">
              <nav
                aria-label="Lesson sections"
                className="rise sticky top-0 z-10 mt-10 bg-paper/85 backdrop-blur-sm border-b border-line"
              >
                <div className="flex gap-1">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => switchTab(t.key)}
                      aria-current={tab === t.key ? "page" : undefined}
                      className={`relative px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
                        tab === t.key ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                      }`}
                    >
                      {t.label}
                      <span
                        className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full transition-all duration-300 ${
                          tab === t.key ? "bg-accent" : "bg-transparent"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </nav>

              <section className="mt-8 pb-24">
                {tab === "slides" && (
                  <Slides
                    lessonId={lessonId}
                    slides={data.materials!.slides}
                    deckMeta={data.deckMeta}
                    lessonTitle={lesson.title}
                    onDeckChange={() => void refresh()}
                    index={index}
                    onIndexChange={setIndex}
                    annos={annos}
                    onPickHighlight={pickHighlight}
                  />
                )}
                {tab === "takeaways" && (
                  <Takeaways takeaways={data.materials!.takeaways} />
                )}
                {tab === "quiz" && (
                  <Quiz
                    lessonId={lessonId}
                    quiz={data.materials!.quiz}
                    attempts={data.attempts}
                    onGraded={() => void refresh()}
                  />
                )}
              </section>
            </div>

            <LessonRail
              tab={tab}
              lessonId={lessonId}
              slides={data.materials!.slides}
              safeIndex={safeIndex}
              annos={annos}
              focusId={focusId}
              onJump={onJump}
            />
          </div>
```

Note the deliberate changes from the old nav/section: the nav lost `-mx-6 px-6` (full-bleed is wrong inside a column) and the inner flex lost `max-w-3xl`; the content `<section>` lost `max-w-3xl` (the grid column constrains width now). The `{tab === "tutor" && <Tutor .../>}` line is gone.

Also widen the `Shell` — change:

```tsx
      className={`mx-auto w-full max-w-6xl px-6 ${
```

to:

```tsx
      className={`mx-auto w-full max-w-7xl px-6 ${
```

- [ ] **Step 7: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0. Common catches: a leftover `focusId`/`AnnotationPanel`/`Tutor` reference in `slides.tsx`/`lesson.tsx`, or `slideCount` referenced before declaration.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Manual verification (the full matrix)**

`npm run dev`, open a ready lesson:
- Rail shows on **Slides, Takeaways, and Quiz**; there is no Tutor top tab.
- On Slides: Notes is visible **before** highlighting; header reads "Your notes · Slide N"; the empty-state hint shows when there are no highlights; selecting text → Highlight adds it and the rail's Notes scrolls/glows to it.
- On Takeaways/Quiz: Notes shows the **roll-up**; clicking an entry jumps to that slide on the Slides view.
- Tutor lives in the rail and persists its thread across tab switches. Ask "explain this slide" — the reply should reference the current slide.
- Keyboard: `←/→/n/g/f` work from the slide, but typing in a note input or the tutor box does **not** navigate slides.
- `Present` (F) fullscreen and `Export → PDF (print)` still work; the rail is absent in print.
- **Re-render check:** start a tutor reply, and while it streams, type in a slide note. The stream must not stutter/reset. (Optionally add a temporary `console.count("tutor render")` in `Tutor` and confirm note keystrokes don't increment it.)
- **Mobile:** narrow the window below `lg` — the rail drops below the reader; the tutor pane has a usable height (not collapsed).

- [ ] **Step 10: Commit**

```bash
git add components/tutor.tsx components/slide-annotations.tsx components/lesson-rail.tsx components/slides.tsx components/lesson.tsx
git commit -m "Two-column lesson layout with persistent Notes + Tutor rail"
```

---

## Task 7: Rail collapse + persistence

Add a collapse control and remember the open/closed choice across reloads.

**Files:**
- Modify: `components/lesson.tsx` (railOpen state + persistence + collapsed layout + reopen button)
- Modify: `components/lesson-rail.tsx` (collapse button in the header)

**Interfaces:**
- `LessonRail` gains `onCollapse: () => void`.
- `Lesson` gains `railOpen` state persisted at `localStorage["folio:lesson-rail-open"]`.

- [ ] **Step 1: Add persisted `railOpen` state to `Lesson`**

In `components/lesson.tsx`, add near the other `useState`s:

```tsx
  const [railOpen, setRailOpen] = useState(true);
```

Hydrate from storage after mount (mirrors the existing `?tab=` restore effect):

```tsx
  useEffect(() => {
    setRailOpen(localStorage.getItem("folio:lesson-rail-open") !== "0");
  }, []);
```

Add a setter that writes through:

```tsx
  function toggleRail(open: boolean) {
    setRailOpen(open);
    localStorage.setItem("folio:lesson-rail-open", open ? "1" : "0");
  }
```

Make `pickHighlight` reopen the rail when a highlight is added while collapsed:

```tsx
  const pickHighlight = (id: string) => {
    setFocusId(id);
    toggleRail(true);
  };
```

- [ ] **Step 2: Branch the grid on `railOpen` and add a reopen button**

In `components/lesson.tsx`, change the grid wrapper so it only uses two columns when open, and render the rail only when open. Change:

```tsx
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0">
```

to:

```tsx
          <div
            className={
              railOpen
                ? "grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]"
                : "mx-auto max-w-3xl"
            }
          >
            <div className="min-w-0">
```

Replace the `<LessonRail ... />` element with a conditional + reopen button:

```tsx
            {railOpen ? (
              <LessonRail
                tab={tab}
                lessonId={lessonId}
                slides={data.materials!.slides}
                safeIndex={safeIndex}
                annos={annos}
                focusId={focusId}
                onJump={onJump}
                onCollapse={() => toggleRail(false)}
              />
            ) : null}
          </div>
          {!railOpen && (
            <button
              type="button"
              onClick={() => toggleRail(true)}
              className="fixed right-4 top-1/2 z-20 -translate-y-1/2 rounded-full border border-line bg-paper-raised px-3 py-2 text-xs text-ink-soft shadow-[0_10px_24px_-12px_rgba(35,29,18,0.5)] hover:border-accent hover:text-accent transition-colors cursor-pointer print:hidden"
            >
              Notes &amp; Tutor
            </button>
          )}
```

Note: the reopen button sits **after** the grid `</div>` so it isn't constrained by the centered column. Make sure the closing `</div>` placement is correct (the grid div closes, then the button, then the `</>` of the ready branch).

- [ ] **Step 3: Add the collapse button to the rail header**

In `components/lesson-rail.tsx`, add `onCollapse` to the props type and signature:

```tsx
export function LessonRail({
  tab,
  lessonId,
  slides,
  safeIndex,
  annos,
  focusId,
  onJump,
  onCollapse,
}: {
  tab: "slides" | "takeaways" | "quiz";
  lessonId: string;
  slides: Slide[];
  safeIndex: number;
  annos: SlideAnnotations;
  focusId: string | null;
  onJump: (index: number) => void;
  onCollapse: () => void;
}) {
```

Add a header row with the collapse control as the first child inside the `<aside>`, before the Notes `<section>`:

```tsx
      <div className="flex shrink-0 items-center justify-between lg:pt-0">
        <p className="font-mono text-xs text-ink-faint">Notes &amp; Tutor</p>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse panel"
          className="rounded-full border border-line px-2 py-1 text-xs text-ink-soft hover:border-ink-faint hover:text-ink transition-colors cursor-pointer"
        >
          Hide ›
        </button>
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

`npm run dev`, ready lesson:
- Click "Hide ›" → rail disappears, the reader centers, the "Notes & Tutor" reopen button appears.
- Reload → the rail stays hidden (persisted). Click reopen → rail returns; reload → it stays open.
- While collapsed, select text on a slide and click Highlight → the rail auto-reopens with the new highlight focused.

- [ ] **Step 7: Commit**

```bash
git add components/lesson.tsx components/lesson-rail.tsx
git commit -m "Rail collapse + remembered open/closed state"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Re-render containment (`React.memo(Tutor)`, primitive props) → Task 6 Step 4 (`TutorPanel = memo(Tutor)`), Step 1 (primitive props).
- Page layout (`max-w-7xl`, grid, dropped nav full-bleed) → Task 6 Step 6.
- The rail (stacked Notes+Tutor, mobile `min-h-[60vh]`, `lg:max-h-[45%]`) → Task 6 Step 4.
- Notes always-on + "Slide N" label + empty state + focusId scroll effect → Task 6 Step 2.
- Space fix → Task 1.
- Roll-up (pure helper + component + jump) → Task 2 (helper), Task 6 Step 3 (`NotesRollup`), Task 6 Step 6 (`onJump`).
- Slides controlled → Task 5.
- Slide-aware tutor (prompt line, sanitizer, route, primitive props/body) → Tasks 3, 4, 6 Step 1.
- Persistence + collapse → Task 7.
- Tutor tab removed → Task 6 Step 6.

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to"; every code step shows the exact code; every test step shows the assertions.

**Type consistency:** `SlideAnnotations` (exported Task 5) used identically in `slides.tsx`, `lesson-rail.tsx`. `onIndexChange: React.Dispatch<React.SetStateAction<number>>` matches `setIndex`. `Tutor` props `{lessonId, slideIndex, slideTitle}` match the `TutorPanel` usage and the `route`/`buildTutorPrompt`/`sanitizeSlideContext` contract (`{index, title}`). `AnnotationPanel` `slideNumber` added in Task 6 Step 2 and supplied in Task 6 Step 4. `rollupEntries(annotations, slides)` signature matches `NotesRollup` usage. `LessonRail` props match between Task 6 (without `onCollapse`) and Task 7 (adds `onCollapse`) — Task 7 updates both the definition and the call site together.

**Note on Task 5→6 churn:** Task 5 intentionally keeps the in-slide `AnnotationPanel`/`annotateOpen` working (green checkpoint); Task 6 removes them. This is deliberate, not a contradiction.

---

## Execution Handoff

(Filled in by the orchestrator after the plan is approved.)
