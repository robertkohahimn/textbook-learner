# Lesson page restructure — reading rail (Notes + Tutor) — design

**Date:** 2026-06-28
**Goal:** Make the individual lesson page a focused *reading* surface. Today the
lesson is a row of top tabs (`Slides · Takeaways · Quiz · Tutor`) inside a narrow
`max-w-3xl` column under a wide `max-w-6xl` shell — so there's a lot of dead space
left and right, you can't read a slide and ask the tutor at the same time, and
"Your notes" only appears *after* you highlight something. Move Notes and Tutor
into a persistent right-hand rail beside the reader, show Notes at all times, and
fix a few related rough edges.

## Decisions (from the user)
- **Rail = stacked, both visible.** Notes on top, Tutor below, in one right rail —
  not a toggle.
- **Rail on all views.** The rail shows on Slides, Takeaways, and Quiz. The
  standalone **Tutor top tab is removed** (it now lives in the rail).
- **Notes off the Slides view = read-only roll-up.** On Slides, Notes edits the
  current slide. On Takeaways/Quiz, Notes shows a read-only roll-up of every slide
  that has a note or highlight; clicking an entry jumps to that slide.
- **"Space" bug = highlight-note typing.** Typing a space in a highlight's note
  does nothing. Fix it. (Not enlarging the field, not cross-gap highlights.)
- **Extras:** remember rail open/closed across reloads; a collapse-rail button;
  slide-aware tutor. (Explicitly *not*: responsive drawer.)

## Approach: lift two pieces of state from `Slides` up to `Lesson`

The rail must render beside *all* views, and its Notes must follow the current
slide — so the slide index and the annotations store can no longer live inside
`Slides` (which is unmounted when you leave the Slides tab). `Lesson` takes
ownership of the **minimum** needed:

- **`index`** (current slide) — `Lesson` owns it; `Slides` becomes controlled via
  `index` + `onIndexChange`.
- **`annos`** — `Lesson` calls `useSlideAnnotations(lessonId)` and passes the
  object to both `Slides` (render/capture highlights) and the rail (Notes).
- **`focusId`** (which highlight the Notes panel should scroll to / glow) and
  **`railOpen`** also live in `Lesson`.

Everything else stays inside `Slides`: `view` (deck/grid), `showNotes` (speaker
notes), `presenting`, `exportOpen`, `customizeOpen`, `reviseOpen`, `selection`,
the floating Highlight button, the stage refs, and all the slide rendering.

This is the smallest cut that makes a persistent, slide-aware rail possible.

## Page layout — `components/lesson.tsx`

- **Shell** widens `max-w-6xl` → `max-w-7xl` (keep `px-6`). Header (Wordmark +
  back link) stays full-width.
- Below the header, when the lesson is `ready`, render a 2-column grid:
  - **Left column:** title/meta section, the sticky tab nav (`Slides · Takeaways ·
    Quiz`), and the active view's content. No longer clamped to `max-w-3xl` — the
    left column gets the reclaimed width (slides auto-scale to it, so they render
    larger; prose views keep a comfortable measure via an inner wrapper).
  - **Right column:** the rail (§ The rail).
  - Grid: `lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8` when the rail is
    open.
- **Collapsed rail (`!railOpen`):** drop to a single column and center the left
  column at `max-w-3xl` for distraction-free reading. Show a small fixed "Notes &
  Tutor" reopen button (right edge).
- **Narrow screens (`< lg`):** the grid is a single column; the rail (a later DOM
  sibling) flows **below** the view, full-width — Notes then Tutor. No drawer. The
  rail is only `sticky`/full-height at `lg+`; on mobile it's static and stacked.
- The rail and its contents are `print:hidden` (printing stays deck-only, as today).

The sticky tab nav keeps its current treatment but loses the Tutor tab:

```ts
const TABS = [
  { key: "slides", label: "Slides" },
  { key: "takeaways", label: "Takeaways" },
  { key: "quiz", label: "Quiz" },
] as const;
```

`?tab=tutor` in an old URL is no longer valid; the existing guard
(`TABS.some(t => t.key === initial)`) already ignores unknown values and falls
back to `slides`, so old links degrade gracefully.

## The rail — `components/lesson-rail.tsx` (new)

A flex column: `lg:sticky lg:top-0 lg:h-[100dvh] flex flex-col`, two stacked
sections separated by a divider.

- **Notes (top):** `flex-none`, capped height (e.g. `lg:max-h-[45%]`) with its own
  vertical scroll. Branches on the active view:
  - `tab === "slides"` → **editable** `SlideNotes` for the current `index`
    (the panel from `slide-annotations.tsx`, see § Notes).
  - otherwise → **read-only** `NotesRollup` (see § Roll-up).
- **Tutor (bottom):** `flex-1 min-h-0`, the `Tutor` component in "fill" mode
  (messages scroll internally; the ask-box pins to the bottom of the rail).
- Rail header: a title and a **collapse** button (chevron) that sets `railOpen`
  false.

The rail is always mounted while the lesson is `ready`, so the tutor chat and
scroll position survive tab switches (an improvement over today, where leaving the
Tutor tab unmounts it).

## Notes — `components/slide-annotations.tsx`

`AnnotationPanel` (rename concept: the editable per-slide notes) changes:

- **Always rendered** when on the Slides view — no `annotateOpen` gate. The old
  `annotateOpen` state and the "Annotate" toolbar button in `Slides` are removed;
  the rail is the home for notes now.
- **Empty state.** When the slide has no note and no highlights, still show the
  "Jot a note for this slide…" box plus a hint: *"Select text on a slide to
  highlight it."*
- **Slide label.** Header reads `Your notes · Slide N` so it's unambiguous which
  slide the notes belong to.
- **`focusId` + scroll-to.** Unchanged behavior: when a highlight is picked (mark
  clicked in the slide, or just created), the matching `#hl-<id>` scrolls into view
  and glows. `focusId` now arrives as a prop from `Lesson`.

### Space-in-highlight-note fix

Root cause: `setHighlightNote` (in `useSlideAnnotations`) stores
`note.trim() || undefined` on **every keystroke**, and the panel's `<input>` is
controlled (`value={h.note ?? ""}`). A leading/trailing space is stripped the
instant it's typed, so the space "does nothing."

Fix: store the **raw** string, matching what `setSlideNote` already does:

```ts
setHighlightNote: (i, id, note) =>
  update(i, (a) => ({
    ...a,
    highlights: a.highlights.map((h) =>
      h.id === id ? { ...h, note } : h   // was: note.trim() || undefined
    ),
  }), true),
```

Trimming still happens server-side in `validateSlideAnnotation` on save/load
(line 160), so a note that is only whitespace persists as empty — acceptable, and
identical to how slide notes behave today. The field stays a single-line `<input>`
(no size change requested).

## Roll-up — `NotesRollup` in `components/slide-annotations.tsx`

A read-only summary shown in the rail when the active view is **not** Slides.

- Input: `annotations: Record<number, SlideAnnotation>`, `slides: Slide[]` (for
  titles), `onJump: (index: number) => void`.
- Derive an ordered list of slides that have a note or ≥1 highlight:
  `[{ index, title, note, highlights }]`, sorted by `index`.
- Each entry renders `Slide N · <title>`, the slide note (if any), and each
  highlight's quote + its note (read-only). The whole entry is a button →
  `onJump(index)`.
- Empty state: *"No notes yet. Open the Slides tab and select text to highlight,
  or jot a note."*
- `onJump(i)` in `Lesson`: `switchTab("slides")`, `setIndex(i)`, and set `focusId`
  to the slide's first highlight (so the editable panel scrolls to it). The rail's
  Notes section then re-renders in editable mode for that slide.

## Slides — `components/slides.tsx` (now controlled)

- **Props:** add `index: number`, `onIndexChange: (next: number) => void`,
  `annos: ReturnType<typeof useSlideAnnotations>`, `onPickHighlight: (id: string)
  => void`. Remove the internal `index` state, the internal `useSlideAnnotations`
  call, `annotateOpen`, and `focusId`.
- `prev`/`next`/grid clicks call `onIndexChange`. The "clamp index when the deck
  shrinks" effect moves to `Lesson` (it owns `index`).
- Slide marks' `onPick` and `addHighlightFromSelection` both call
  `onPickHighlight(id)` (Lesson opens the rail if collapsed, sets `focusId`, and
  the rail's editable Notes scrolls to it). `addHighlightFromSelection` still calls
  `annos.addHighlight(...)` first.
- The `AnnotationPanel` render block and the "Annotate" `ToolButton` are removed
  from `Slides` (notes now live only in the rail).
- The window `keydown` handler is unchanged and still early-returns for
  `INPUT`/`TEXTAREA`/`contentEditable` — so typing in the rail's note inputs and
  the tutor textarea never triggers slide navigation (`←/→`, `n`, `g`, `f`).
- Fullscreen "present" still targets `presentRef` inside `Slides` and covers the
  viewport; the rail is unaffected.

## Slide-aware tutor

- **`components/tutor.tsx`:** add prop `currentSlide?: { index: number; title:
  string }`. Include it in the POST body as
  `slideContext: currentSlide && { index, title }`. Also add a layout variant so
  the component fills the rail: messages area `flex-1 overflow-y-auto`, the form
  pinned at the bottom of the flex container instead of `sticky bottom-0` page
  scroll, and drop the `max-w-2xl` when in the rail.
- **`app/api/lessons/[lessonId]/tutor/route.ts`:** read
  `body.slideContext` (validate: integer `index ≥ 0`, string `title`) and pass it
  to `buildTutorPrompt`.
- **`lib/tutor.ts`:** `buildTutorPrompt` gains an optional
  `currentSlide?: { index: number; title: string }` param. When present, append one
  line to the system prompt:
  *"The student is currently viewing slide ${index + 1}: \"${title}\". If they say
  'this', 'this slide', or 'here', assume they mean that slide unless the
  conversation says otherwise."*
- The slide number/title is enough to disambiguate deictic questions; the full
  lesson text is already in the system prompt, so we don't resend slide bodies.

## Persistence & collapse

- **`railOpen`** persists in `localStorage` under `folio:lesson-rail-open`
  (`"1"`/`"0"`). Default **open**. Hydrate in a mount `useEffect` (same pattern as
  the existing `?tab=` restore) so SSR renders the default and there's no markup
  mismatch. The collapse button and the reopen button both write through to
  storage.
- Rail open/closed is a global UI preference (not per-lesson), so a single key is
  fine and matches the lightweight feel of the `?tab=` memory.

## Data flow (after)

```
Lesson
 ├─ owns: tab, index, focusId, railOpen, annos = useSlideAnnotations(lessonId)
 ├─ left column
 │   ├─ title/meta
 │   ├─ tab nav (slides | takeaways | quiz)
 │   └─ view: Slides(index, onIndexChange, annos, onPickHighlight)
 │            | Takeaways | Quiz
 └─ LessonRail (mounted while ready)
     ├─ Notes:  tab==="slides" ? SlideNotes(annos[index], index, focusId, handlers)
     │                          : NotesRollup(annos, slides, onJump)
     └─ Tutor(lessonId, currentSlide = slides[index])
```

## Edge cases

- **Deck regenerate / revise** still clears annotations via the existing
  `annos.reset()` / `annos.clearLocal(i)` calls (now invoked from `Slides` against
  the passed-in `annos`); `index` clamps in `Lesson`.
- **Highlight added while rail collapsed** → `onPickHighlight` opens the rail.
- **Roll-up while a slide's only content is a note** (no highlights) → still listed;
  `onJump` sets `focusId` to `null` (nothing to scroll to) and just navigates.
- **Print** → rail `print:hidden`; the existing print-only full-deck block is
  untouched.
- **Mobile** → rail stacks below the view; not sticky; collapse button still works
  (hides it; reopen button brings it back).

## Testing

- **Manual (primary):** with a ready lesson — rail shows Notes + Tutor on all three
  tabs; Notes is visible before any highlight; typing a space in a highlight note
  works; selecting text still highlights and opens/focuses the rail; collapse +
  reload remembers the state; switching to Takeaways shows the roll-up and clicking
  an entry jumps back to that slide; "explain this" in the tutor references the
  current slide; `←/→/n/g/f` still navigate from the slide but not while typing in
  a note/tutor box; present (F) fullscreen still works; print still emits the deck.
- **Unit:** `buildTutorPrompt` includes the slide line when `currentSlide` is
  passed and omits it otherwise. `NotesRollup`'s derive-list helper (pure) returns
  the right ordered subset.
- Run the project's typecheck/lint after the change.

## Files touched

- `components/lesson.tsx` — widen shell; 2-col grid; lift `index`/`annos`/
  `focusId`/`railOpen`; remove Tutor tab; render `LessonRail`.
- `components/lesson-rail.tsx` *(new)* — the stacked Notes + Tutor rail, collapse.
- `components/slides.tsx` — controlled `index`; take `annos`/`onPickHighlight`;
  remove `AnnotationPanel`/"Annotate"/`annotateOpen`/internal `index`+`annos`.
- `components/slide-annotations.tsx` — `setHighlightNote` raw-store fix; always-on
  + empty-state + "Slide N" label for the editable panel; new `NotesRollup`.
- `components/tutor.tsx` — `currentSlide` prop + `slideContext` in POST; rail fill
  layout variant.
- `app/api/lessons/[lessonId]/tutor/route.ts` — accept/validate `slideContext`.
- `lib/tutor.ts` — `buildTutorPrompt` optional `currentSlide`.

## Out of scope (YAGNI)

Responsive slide-over drawer; dragging a highlight across the gap between
bullets/lines (multi-field selection); enlarging the highlight-note input to a
multi-line area. None were requested; leave them out.

> **Implementation note:** this repo runs a non-standard Next.js — per `AGENTS.md`,
> read the relevant guide in `node_modules/next/dist/docs/` before writing code.
