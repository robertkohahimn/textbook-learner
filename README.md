# Folio — study any book

Folio is a local-first study platform. Drop in a PDF book and it builds a
curriculum around it: modules and lessons mapped to page ranges, with
generated **slides**, **key takeaways**, and a **quiz** for every lesson — plus
an **AI tutor** that has read the exact pages you're studying.

## Requirements

- Node 20+
- An LLM backend, either of:
  - the **claude CLI** installed and logged in (Claude Code) — used by default, or
  - an **`ANTHROPIC_API_KEY`** in the environment — used automatically when set.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and drop in a PDF.

What happens next: Folio extracts every page, designs a curriculum (about a
minute), then pre-generates lesson materials in the background, in order.
Opening a lesson that isn't ready yet jumps it to the front of the queue.

## Slide decks

Every lesson gets a full slide deck, not just bullet lists:

- **Eight layouts** — title, section divider, bullets, two-column comparison,
  verbatim quote, big fact, process/steps, and recap — arranged in a narrative
  arc from hook to recap.
- **Speaker notes** on every slide (`N` to toggle) and **page citations** back
  to the exact book pages each slide draws from.
- **Typeset math** — the model writes notation in LaTeX (`$...$` / `$$...$$`)
  and it renders with KaTeX across slides, takeaways, quiz, and the tutor.
  Web and PDF are pixel-perfect; the PPTX export approximates math in editable
  Unicode (α, ⟨ψ|, ², ⊗ …).
- **Customize & regenerate** — presenter vs. detailed format, short/standard/
  in-depth length, and a free-form focus prompt ("explain it for a
  12-year-old", "go deep on the math").
- **Revise one slide** with an instruction; the revision stays grounded in the
  lesson's source pages.
- **Annotate** — select text on a slide to **highlight** it, attach a note to
  any highlight, and write a personal note per slide. Highlights and notes
  persist per lesson and survive reload; annotated slides are flagged on the
  nav dots.
- **Present mode** (`F`), **overview grid** (`G`), arrow-key navigation.
- **Export** to PowerPoint (editable text + speaker notes) or print-to-PDF.

## Environment variables

| Variable            | Default            | Purpose                                          |
| ------------------- | ------------------ | ------------------------------------------------ |
| `ANTHROPIC_API_KEY` | _(unset)_          | Use the Anthropic API instead of the claude CLI  |
| `LLM_MODEL`         | `sonnet`           | Model for generation (CLI alias or full API id)  |
| `DATA_DIR`          | `./data`           | Where the SQLite DB and uploaded PDFs live       |

### GLM (Zhipu AI) as an alternative model

Folio can use GLM via z.ai's Anthropic-compatible endpoint. Switch models at runtime on
the **Settings** page (`/settings`); the choice is global and applies to curriculum,
slides, quizzes, and the tutor.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GLM_API_KEY` | _(unset)_ | z.ai API key. Required to enable/select GLM. Sent as `Authorization: Bearer`. |
| `GLM_MODEL` | `glm-4.7` | GLM model id. Must be GA and entitled on your z.ai plan. |
| `GLM_BASE_URL` | `https://api.z.ai/api/anthropic` | z.ai's Anthropic-compatible base URL (used by the Anthropic SDK). The default also serves GLM Coding Plan keys — the plan is selected by the key, not a different URL. Do not point this at `…/api/coding/paas/v4`; that is z.ai's OpenAI-compatible surface and is incompatible with the Anthropic SDK. |

With no `GLM_API_KEY`, the GLM option is disabled in Settings and Folio behaves exactly
as before (Anthropic API when `ANTHROPIC_API_KEY` is set, otherwise the local `claude` CLI).

## Data layout

```
data/
  app.db        # SQLite: books, pages, curriculum, materials, quiz attempts, tutor chats
  uploads/      # original PDFs, one per book
```

Delete a book from the library UI to remove its data; delete `data/` to reset
everything.

## Development

```bash
npm test           # unit tests (vitest)
LIVE=1 npm test    # also run live claude-CLI smoke tests
npm run build      # production build
node scripts/e2e.mjs   # browser E2E against a running dev server with a processed book
node scripts/seed-demo.mjs   # seed a demo lesson with every slide layout (no LLM; run the app once first)
node scripts/deck-shots.mjs  # screenshot the slides UI states against a running dev server
```

Notes:

- Scanned books (no extractable text) are rejected with a clear error — there
  is no OCR.
- Design docs live in `docs/superpowers/specs/` and plans in
  `docs/superpowers/plans/`.
