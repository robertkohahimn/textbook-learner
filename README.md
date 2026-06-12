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

## Environment variables

| Variable            | Default            | Purpose                                          |
| ------------------- | ------------------ | ------------------------------------------------ |
| `ANTHROPIC_API_KEY` | _(unset)_          | Use the Anthropic API instead of the claude CLI  |
| `LLM_MODEL`         | `sonnet`           | Model for generation (CLI alias or full API id)  |
| `DATA_DIR`          | `./data`           | Where the SQLite DB and uploaded PDFs live       |

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
```

Notes:

- Scanned books (no extractable text) are rejected with a clear error — there
  is no OCR.
- Design docs live in `docs/superpowers/specs/` and plans in
  `docs/superpowers/plans/`.
