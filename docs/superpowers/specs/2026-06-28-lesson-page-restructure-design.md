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

### Re-render containment (mandatory, not optional)

`useSlideAnnotations` calls `setAnnotations` **synchronously on every keystroke**
in a note — the `debounce` flag defers only the network `PUT`, not the state
update (`update()` → `setAnnotations`). Today the hook lives in `Slides`, so that
re-render is contained to the Slides subtree. Lifting it to `Lesson` would
re-render the **entire** `Lesson` tree on every character typed — including
`Tutor`, which may be mid-stream, and which re-renders `katex.renderToString` is
*not* involved in but the streaming markdown is. That is a latency/UX regression
worse than the layout it replaces.

Mitigation — wrap `Tutor` in `React.memo` and pass it **primitive** props that do
not change while typing a note, so the memo skips the re-render:

```tsx
const TutorPanel = React.memo(Tutor);
// ...
const safeIndex = Math.min(index, slides.length - 1);
<TutorPanel
  lessonId={lessonId}
  slideIndex={safeIndex}
  slideTitle={slides[safeIndex]?.title ?? ""}
/>
```

Primitives (not an object literal) avoid a `useMemo` and keep the memo's shallow
compare stable across note edits. The reverse direction is already safe: `Tutor`'s
`liveText` is local state and does not propagate upward, so streaming never thrashes
the slide. Do **not** also `React.memo(Slides)` keyed on `annos`: the hook returns a
fresh object literal with fresh inline closures every render (`addHighlight`,
`setHighlightNote`, … are not `useCallback`-stabilized), so that memo would never
hit. `Slides` re-rendering on note edits is preexisting and acceptable; leave it.

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

The sticky tab nav loses the Tutor tab **and** its full-bleed. Today the nav uses
`-mx-6 px-6` to reach the viewport edges under the single-column shell
(`lesson.tsx:146-148`); inside a `minmax(0,1fr)` grid column those negative margins
bleed into the gap and under the rail. Drop them — the nav becomes
`sticky top-0 z-10 bg-paper/85 backdrop-blur-sm border-b border-line` confined to
the left column. The nav's `z-10` and the rail's sticky `top-0` coexist (different
columns); keep the nav's z-index from exceeding the rail's stacking context.

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
- **Tutor (bottom):** `flex-1 min-h-0` at `lg+` (messages scroll internally; the
  ask-box pins to the bottom of the rail). **Mobile sizing is mandatory:** the rail
  is static (not `h-[100dvh]`) below `lg`, so `flex-1` has no basis and the tutor
  would collapse to ~0px. Give the tutor pane `min-h-[60vh] lg:min-h-0` so it stays
  usable when the rail stacks under the reader. The Notes cap (`lg:max-h-[45%]`) is
  already `lg:`-scoped, so it correctly does not constrain mobile.
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
- **`focusId` + scroll-to (relocated).** Today the scroll lives inside
  `Slides.pickHighlight` as a `setTimeout(60)` + `scrollIntoView` (`slides.tsx:74-82`).
  That mechanism is now orphaned — the panel lives in the rail. Move it into the
  editable panel as a post-commit effect, which also drops the fragile timeout
  (the effect runs after the panel has rendered the target):

  ```tsx
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`hl-${focusId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusId]);
  ```

  `focusId` arrives as a prop from `Lesson`. Known edge: re-picking the **same**
  highlight id will not refire (deps unchanged); if that becomes annoying, carry a
  focus nonce `{ id, n }` instead of a bare id. Deferred — name it, don't build it.

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

- **`components/tutor.tsx`:** take **primitive** props `slideIndex: number` and
  `slideTitle: string` (per the memo requirement above — an object literal would
  defeat `React.memo`). On send, include
  `slideContext: { index: slideIndex, title: slideTitle }` in the POST body.
  **No layout variant** — after this change `Tutor` has exactly one caller (the
  rail), so convert its layout outright rather than branching: messages area
  `flex-1 overflow-y-auto`, the form pinned at the bottom of the flex container
  instead of `sticky bottom-0` page scroll, and delete `max-w-2xl` unconditionally.
  The existing `bottomRef.scrollIntoView({ block: "end" })` autoscroll still works
  against the nearest scroll container.
- **`app/api/lessons/[lessonId]/tutor/route.ts`:** read `body.slideContext` and
  sanitize the **index only** (`Number.isInteger(index) && index >= 0`). Bounds-check
  it against `materials.slides` and derive the title from the server-side slide
  (`slides[index].title`) — the title goes into the system prompt, so it must come
  from authoritative materials, never from client text. (Updated post-review: the
  original plan truncated a client-supplied title; deriving server-side removes the
  injection surface and prevents index/title desync.) Pass the derived `{ index, title }`
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
  the existing `?tab=` restore). The collapse button and the reopen button both
  write through to storage.
- **Honest tradeoff:** there is no hydration *markup* mismatch (SSR renders the
  default `open`, and the first client render matches), but a user who prefers
  **closed** sees the two-column grid paint and then collapse to one column after
  mount — a one-frame layout flash. Acceptable for a study app. If it grates, the
  only clean fix is a blocking inline `<script>` in the document head that sets a
  class before first paint; not worth it now.
- Rail open/closed is a global UI preference (not per-lesson), so a single key is
  fine and matches the lightweight feel of the `?tab=` memory.

## Data flow (after)

```text
Lesson
 ├─ owns: tab, index, focusId, railOpen, annos = useSlideAnnotations(lessonId)
 ├─ safeIndex = min(index, slides.length - 1)
 ├─ left column
 │   ├─ title/meta
 │   ├─ tab nav (slides | takeaways | quiz)   ← no -mx-6/px-6 full-bleed
 │   └─ view: Slides(index, onIndexChange, annos, onPickHighlight)
 │            | Takeaways | Quiz
 └─ LessonRail (mounted while ready)
     ├─ Notes:  tab==="slides" ? SlideNotes(annos[safeIndex], safeIndex, focusId, handlers)
     │                          : NotesRollup(annos.annotations, slides, onJump)
     └─ React.memo(Tutor)(lessonId, slideIndex=safeIndex, slideTitle=slides[safeIndex]?.title)
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
- **Regression — re-render containment (CRITICAL-1):** while the tutor is mid-stream,
  type in a slide note. The streaming reply must not stutter or reset. Confirm via
  React DevTools "Highlight updates" (or a `console.count` in `Tutor`) that
  per-keystroke note edits do **not** re-render the memoized `Tutor`.
- **Regression — mobile tutor height (CRITICAL-2):** at `< lg` width the stacked
  tutor pane has a usable height (not collapsed to ~0px) and its ask-box is reachable.
- **Unit:** `buildTutorPrompt` includes the slide line when `currentSlide` is
  passed and omits it otherwise. `NotesRollup`'s derive-list helper (pure) returns
  the right ordered subset.
- Run the project's typecheck/lint after the change.

## Files touched

- `components/lesson.tsx` — widen shell; 2-col grid; lift `index`/`annos`/
  `focusId`/`railOpen`; remove Tutor tab; drop the nav full-bleed (`-mx-6 px-6`);
  render `LessonRail`; wrap the tutor in `React.memo` with primitive props.
- `components/lesson-rail.tsx` *(new)* — the stacked Notes + Tutor rail (mobile
  `min-h-[60vh]` tutor pane), collapse button.
- `components/slides.tsx` — controlled `index`; take `annos`/`onPickHighlight`;
  remove `AnnotationPanel`/"Annotate"/`annotateOpen`/internal `index`+`annos`; the
  `setTimeout` scroll moves out (now a `focusId` effect in the panel).
- `components/slide-annotations.tsx` — `setHighlightNote` raw-store fix; always-on
  + empty-state + "Slide N" label + `focusId` scroll effect for the editable panel;
  new `NotesRollup`.
- `components/tutor.tsx` — primitive `slideIndex`/`slideTitle` props + `slideContext`
  in POST; layout converted outright to fill the rail (no variant flag).
- `app/api/lessons/[lessonId]/tutor/route.ts` — accept/validate/bound `slideContext`.
- `lib/tutor.ts` — `buildTutorPrompt` optional `currentSlide`.

## Out of scope (YAGNI)

Responsive slide-over drawer; dragging a highlight across the gap between
bullets/lines (multi-field selection); enlarging the highlight-note input to a
multi-line area. None were requested; leave them out.

> **Implementation note:** this repo runs a non-standard Next.js — per `AGENTS.md`,
> read the relevant guide in `node_modules/next/dist/docs/` before writing code.
