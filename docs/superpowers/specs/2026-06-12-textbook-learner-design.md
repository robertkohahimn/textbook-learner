# Textbook Learner — Design Spec

**Date:** 2026-06-12
**Status:** Approved autonomously (goal-directive session; user not available for review)

## Purpose

A local-first web platform for studying books effectively. The user uploads a PDF book;
the platform generates a curriculum (modules → lessons mapped to page ranges) and, per
lesson, study materials: slides, key takeaways, and a quiz. An AI tutor chat is available
inside each lesson, grounded in that lesson's source text. UI/UX must be friendly, smooth,
and seamless.

Reference test book: `Quantum Computing for Everyone` (Chris Bernhardt), ~4.5 MB PDF at
`/Users/Maestro/Vault/Thinking/03_Study/Quantum/Quantum Computing For Everyone/Quantum computing for everyone by Bernhardt, Chris (z-lib.org).pdf`.

## Constraints & environment

- Runs locally on the user's Mac (Node 23). Single user, no auth.
- `ANTHROPIC_API_KEY` is **not** set; `claude` CLI v2.1.173 **is** installed and authenticated.
  → Primary LLM backend: `claude -p` headless mode. Secondary: Anthropic SDK when
  `ANTHROPIC_API_KEY` is present.
- Generation latency (30–60s per LLM call) is acceptable if the UI communicates progress
  well and materials are pre-generated in the background.

## Architecture

Single Next.js 15 (App Router, TypeScript, Tailwind v4) app. API routes are the backend.
Data on disk under `data/` (gitignored):

- `data/app.db` — SQLite via `better-sqlite3`
- `data/uploads/<bookId>.pdf` — original PDFs

### Units

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `lib/db.ts` | SQLite schema + typed queries | better-sqlite3 |
| `lib/pdf.ts` | Extract per-page text + outline from a PDF | unpdf |
| `lib/llm/` | `LlmProvider` interface: `generate()` + `stream()`; `claude-cli.ts` and `anthropic.ts` impls; factory picks by env | claude CLI / @anthropic-ai/sdk |
| `lib/curriculum.ts` | Prompt + JSON parsing/validation for curriculum generation | llm, db |
| `lib/materials.ts` | Prompt + JSON parsing/validation for slides/takeaways/quiz | llm, db |
| `lib/tutor.ts` | Builds grounded tutor prompt from lesson text + chat history | llm, db |
| `lib/jobs.ts` | In-process background queue (global singleton): book processing, lesson pre-generation | all above |
| `app/api/*` | Thin HTTP layer over lib | lib |
| `app/*` (pages) | Library, book/curriculum, lesson views | API via fetch/SWR-style polling |

### Data model (SQLite)

- `books` — id, title, author, filename, num_pages, status (`processing` | `ready` | `error`), error, accent (UI color seed), created_at
- `pages` — book_id, page_number, text
- `modules` — id, book_id, position, title, description
- `lessons` — id, module_id, book_id, position, title, summary, page_start, page_end,
  status (`pending` | `generating` | `ready` | `error`), completed_at
- `materials` — lesson_id, slides JSON, takeaways JSON, quiz JSON
- `quiz_attempts` — id, lesson_id, score, total, answers JSON, created_at
- `tutor_messages` — id, lesson_id, role, content, created_at

### Flows

**Upload → curriculum.** POST `/api/books` saves the PDF, creates a `processing` book,
and enqueues a job: extract per-page text (unpdf) → store pages → LLM call with title,
PDF outline (if any), and clipped per-page excerpts → parse/validate curriculum JSON
(modules with lessons; each lesson has a page range) → store → book `ready` → enqueue
material pre-generation for all lessons in order. The upload page polls book status and
shows staged progress.

**Lesson materials.** Generated per lesson from the lesson's page-range text (clipped
~30k chars). One LLM call returns JSON: `slides[] {title, bullets[]}`,
`takeaways[] {point, detail}`, `quiz[] {question, choices[4], answerIndex, explanation}`.
Lazy trigger: opening a lesson whose status is `pending` starts generation immediately
(jump the queue); UI polls until `ready`. Background queue pre-generates the rest.

**Tutor.** POST `/api/lessons/[id]/tutor` streams the reply (SSE over a ReadableStream).
Stateless prompting: system prompt embeds lesson source text + takeaways; the full prior
message history is included in each request. History persisted in `tutor_messages`.

**LLM via claude CLI.** Spawn `claude -p --output-format json` (generation) /
`--output-format stream-json --include-partial-messages --verbose` (streaming), prompt on
stdin, cwd = `data/` (neutral, avoids loading this project's CLAUDE.md/skills). Parse
defensively: strip code fences, extract first JSON object, validate shape, one retry on
invalid JSON. Model: `sonnet` by default, `LLM_MODEL` env override.

### Pages & UX

- `/` — Library: book cards (title, author, progress ring), drag-and-drop + click upload
  zone, friendly empty state. Upload transitions into staged processing view
  (extracting → analyzing → building curriculum) with live polling.
- `/books/[id]` — Curriculum: modules as sections, lessons as rows with status
  (ready / generating / locked-pending) and completion checkmarks; overall progress bar;
  "Continue studying" CTA jumping to the next incomplete lesson.
- `/books/[id]/lessons/[lessonId]` — Lesson workspace: header with lesson title, page
  range, prev/next nav, "Mark complete". Tabbed content: **Slides** (keyboard/arrow
  navigable card deck with progress dots), **Takeaways** (scannable list), **Quiz**
  (one question at a time, instant feedback + explanation, score summary, retake,
  attempts recorded), **Tutor** (chat with streamed responses, suggested starter
  questions). Generating state shows a friendly skeleton with live status.

Design language: calm scholarly aesthetic — warm paper background, ink text, serif
display type paired with a clean sans, one deep accent color per book; smooth micro-
transitions; no generic AI-slop styling. (frontend-design skill applied at build time.)

### Error handling

- PDF parse failure / zero text (scanned book) → book status `error` with a clear,
  human message and a "remove" action. OCR is out of scope.
- LLM JSON invalid after one retry → lesson/book `error`, retry button in UI.
- CLI missing/auth failure → surfaced as setup guidance on the library page.
- Tutor stream failure → error bubble in chat with retry.

### Testing

- Vitest unit tests for the pure core: JSON extraction/validation (curriculum,
  materials), page-range assembly, CLI stream-event parsing. TDD for these units.
- End-to-end: Playwright (webapp-testing) against the dev server with the real
  reference book — upload, curriculum appears, lesson materials render, quiz flow,
  tutor answers a question.

## Out of scope (YAGNI)

OCR for scanned PDFs, multi-user/auth, spaced repetition, EPUB, cloud deploy,
flashcards, exporting materials.
