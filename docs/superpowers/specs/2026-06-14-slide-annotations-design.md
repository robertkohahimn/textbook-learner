# Slide annotations — highlights + personal notes — design

**Date:** 2026-06-14
**Goal:** Let the learner annotate a slide: highlight text by selecting it with the
cursor, attach a note to a highlight, and write one personal note per slide.
Today the slide's speaker notes are view-only; there is no user-authored layer.

## Decisions (from the user)
- **Highlighting = cursor text selection.** Select text on a slide → a floating
  "Highlight" button → the run is marked.
- **Notes = both.** One free-text note per slide *and* an optional note per
  highlight.

## Data model

Annotations are personal and mutable, so they live apart from the generated
deck. Per `(lesson, slideIndex)`:

```ts
interface Highlight {
  id: string;          // stable id (newId on create)
  field: string;       // which text field — see field keys below
  start: number;       // inclusive offset into the field's logical string
  end: number;         // exclusive
  quote: string;       // the highlighted text (for the panel + resilience)
  note?: string;       // optional per-highlight note
}
interface SlideAnnotation {
  note: string;            // per-slide personal note
  highlights: Highlight[];
}
```

**Logical string.** A field's text is `splitMath()`-segmented into text and math
segments. The *logical string* is `segments.map(s => s.value).join("")` — math
counts as its source length and is **atomic** (a highlight either covers a whole
math unit or none of it). Capture and render both use this same model, so
offsets are stable across re-render (KaTeX HTML never enters the math).

**Field keys** (unique within a slide): `title`, `subtitle`, `bullet:N`,
`col:C:heading`, `col:C:bullet:N`, `quote`, `attribution`, `fact:value`,
`fact:label`, `step:N:label`, `step:N:detail`.

## Persistence

- `lib/db.ts` migration adds
  `slide_annotations(lesson_id, slide_index, data TEXT, updated_at, PK(lesson_id, slide_index))`
  where `data` is the JSON `SlideAnnotation`.
- Queries: `getSlideAnnotations(lessonId) -> Record<number, SlideAnnotation>`,
  `saveSlideAnnotation(lessonId, index, data)`, `deleteSlideAnnotation(lessonId, index)`,
  `deleteSlideAnnotations(lessonId)`.
- Slide content can change under an annotation, so: the deck-regenerate route
  clears all of a lesson's annotations; the single-slide revise route clears
  that slide's annotation. (Indices/content would otherwise drift.)

## API — `app/api/lessons/[lessonId]/annotations/route.ts`
- `GET` → `{ annotations: Record<number, SlideAnnotation> }`.
- `PUT` body `{ slideIndex, annotation }` → validated upsert; returns the saved
  annotation. (Whole-slide annotation sent on each change — small payloads.)

## Pure core — `lib/annotations.ts` (unit tested)
- `validateSlideAnnotation(data): SlideAnnotation` — sanitize API/DB input.
- `buildFieldPieces(text, ranges): Piece[]` — split a field into ordered render
  pieces `{ kind: "text"|"math", value, marked, ids }`: text segments are cut at
  highlight boundaries; a math segment is `marked` if any range overlaps it.
  This is the shared, testable heart of highlight rendering.

## Client

- **`components/slide-annotations.tsx`**
  - `<Highlightable field text highlights onPick>` — generalizes `MathText`:
    renders `buildFieldPieces`, wrapping marked pieces in `<mark data-hl-id>`.
    No highlights → identical to `MathText` (fast path). The wrapper carries
    `data-anno-field`; math pieces carry `data-anno-math` and are not descended
    into when measuring offsets.
  - `useSlideAnnotations(lessonId)` — loads once, exposes the map + `save`,
    `removeHighlight`, `addHighlight`, `setSlideNote`, `setHighlightNote`
    (optimistic local update + debounced `PUT`).
  - Selection capture (in `Slides`): on `mouseup`/`selectionchange` inside the
    stage, find the `[data-anno-field]` ancestor, map the range's start/end to
    logical offsets (walk leaf text + math atoms; a boundary inside a math atom
    snaps to its edge), and show a floating toolbar at the selection rect.
  - `<AnnotationPanel>` — per-slide note textarea + a list of this slide's
    highlights (quote, a note input each, remove). Clicking a `<mark>` focuses
    its entry.
- **`components/slides.tsx`** — replace `<MathText>` in `SlideBody` with
  `<Highlightable>` (passing field key + that field's highlights); mount the
  selection toolbar and an "Annotate" toggle that opens the panel; show an
  annotation indicator on nav dots and a count on the toggle. Selection
  highlighting is enabled in normal deck view (not present/grid).

## Testing
- `tests/annotations.test.ts` — `buildFieldPieces` (plain, one range, range over
  a math unit, multiple/adjacent ranges, range at boundaries, no ranges) and
  `validateSlideAnnotation` (defaults, clamping, dropping malformed highlights).
- `tests/db.test.ts` — round-trip + delete-one + delete-all for annotations.
- Existing suites stay green (new table/column only; deck/materials untouched).
- Visual: Playwright — select text, click Highlight, reload (persists), add a
  per-highlight note and a per-slide note, remove a highlight.

## Out of scope
- No multi-user/auth (local single user) — keyed by lesson+slide only.
- No cross-slide or cross-field selections (clamped to the start field).
- No highlight color choices — one marker style.
