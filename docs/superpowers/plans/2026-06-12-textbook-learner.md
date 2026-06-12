# Textbook Learner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local-first web platform: upload a PDF book → generated curriculum → per-lesson slides, takeaways, quiz, and a grounded AI tutor chat.

**Architecture:** Single Next.js 15 App Router app. SQLite (`better-sqlite3`) + `data/` dir for persistence. `unpdf` for extraction. LLM via `claude -p` headless CLI (Anthropic SDK fallback when `ANTHROPIC_API_KEY` set). In-process job queue (globalThis singleton) for book processing and lesson pre-generation. Spec: `docs/superpowers/specs/2026-06-12-textbook-learner-design.md`.

**Tech Stack:** Next.js 15, TypeScript, Tailwind v4, better-sqlite3, unpdf, vitest, claude CLI.

**Spike results (validated 2026-06-12):** `claude -p --output-format json --model sonnet` returns `{type:"result", result:"..."}` in ~3s for trivial prompts; `--include-partial-messages` flag exists. `unpdf` extracts the reference book cleanly: 214 pages, 362k chars, metadata title/author, 13-item outline.

**Note on granularity:** Plan author = executor (same autonomous session). Lib-layer tasks carry full code (the contract). UI tasks carry interfaces + acceptance criteria; visual design is produced at build time under the `frontend-design` skill, which forbids pre-baking generic markup here. Package manager: **npm** (pnpm v10 blocks better-sqlite3 postinstall builds by default).

---

### Task 1: Scaffold

**Files:** Create Next.js app in repo root; modify `next.config.ts`, `.gitignore`, `package.json`.

- [ ] `npx create-next-app@latest . --ts --tailwind --app --no-eslint --no-src-dir --import-alias "@/*" --use-npm` (in repo root; tolerate existing README/docs by temp-moving if needed)
- [ ] `npm i better-sqlite3 unpdf && npm i -D vitest @types/better-sqlite3`
- [ ] `next.config.ts`: `serverExternalPackages: ['better-sqlite3']`
- [ ] `.gitignore`: add `data/`
- [ ] `package.json` scripts: `"test": "vitest run"`
- [ ] Verify: `npm run build` passes. Commit.

### Task 2: JSON extraction util (TDD)

**Files:** Create `lib/json.ts`, `tests/json.test.ts`.

- [ ] Failing tests: plain JSON, fenced ```json block, prose-wrapped object, arrays, invalid → throws.

```ts
// lib/json.ts
export function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], raw]
  for (const c of candidates) {
    if (!c) continue
    const start = Math.min(...['{', '['].map(ch => { const i = c.indexOf(ch); return i === -1 ? Infinity : i }))
    if (start === Infinity) continue
    for (let end = c.length; end > start; end--) {
      const slice = c.slice(start, end).trim()
      if (!slice.endsWith('}') && !slice.endsWith(']')) continue
      try { return JSON.parse(slice) as T } catch { /* keep shrinking */ }
    }
  }
  throw new Error('No valid JSON found in LLM output')
}
```

- [ ] `npm test` green. Commit.

### Task 3: LLM providers

**Files:** Create `lib/llm/types.ts`, `lib/llm/claude-cli.ts`, `lib/llm/anthropic.ts`, `lib/llm/index.ts`, `tests/llm.test.ts`.

```ts
// lib/llm/types.ts
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface LlmProvider {
  generate(prompt: string, opts?: { system?: string }): Promise<string>
  stream(prompt: string, opts?: { system?: string }): AsyncIterable<string>
}
```

`claude-cli.ts`: spawn `claude` with `['-p', '--output-format', 'json', '--model', MODEL, ...(system ? ['--append-system-prompt', system] : [])]`, prompt on **stdin**, `cwd: DATA_DIR`, env minus `CLAUDECODE`. Parse stdout JSON → check `is_error` → return `.result`. Reject on exit≠0 with stderr tail. 5-min timeout via AbortSignal/kill.

`stream()`: same but `['--output-format', 'stream-json', '--include-partial-messages', '--verbose']`; parse JSONL: yield text from `event.type==='stream_event' && event.event?.type==='content_block_delta' && event.event.delta?.type==='text_delta'` → `delta.text`. Track whether any partial text was yielded; if none, yield full `result` from the final `type==='result'` line. Export pure `parseStreamLine(line: string): {text?: string; result?: string}` for testing.

`anthropic.ts`: lazy `import('@anthropic-ai/sdk')` only when used (dep installed in this task: `npm i @anthropic-ai/sdk`); `claude-sonnet-4-6`, max_tokens 8192, streaming via SDK.

`index.ts`: `getLlm(): LlmProvider` → Anthropic if `process.env.ANTHROPIC_API_KEY`, else CLI. `MODEL = process.env.LLM_MODEL ?? 'sonnet'`.

- [ ] TDD `parseStreamLine` (delta line, result line, non-JSON line, tool-use noise → ignored)
- [ ] Live smoke test (skippable, `it.skipIf(!process.env.LIVE)`): `generate('Reply OK')`.
- [ ] `npm test` green. Commit.

### Task 4: Database

**Files:** Create `lib/db.ts`, `tests/db.test.ts`.

Schema (all `CREATE TABLE IF NOT EXISTS`, WAL mode, FKs ON):

- `books(id TEXT PK, title, author, filename, num_pages INT DEFAULT 0, status DEFAULT 'processing', stage, error, accent INT DEFAULT 0, created_at DEFAULT datetime('now'))`
- `pages(book_id FK CASCADE, page_number INT, text, PK(book_id,page_number))`
- `modules(id PK, book_id FK CASCADE, position INT, title, description)`
- `lessons(id PK, module_id FK CASCADE, book_id FK CASCADE, position INT, title, summary, page_start INT, page_end INT, status DEFAULT 'pending', error, completed_at)`
- `materials(lesson_id PK FK CASCADE, slides TEXT, takeaways TEXT, quiz TEXT)`
- `quiz_attempts(id PK, lesson_id FK CASCADE, score INT, total INT, answers TEXT, created_at)`
- `tutor_messages(id PK, lesson_id FK CASCADE, role, content, created_at)`

Export: `getDb()` singleton (`globalThis.__db`), DB path `data/app.db` (env `DATA_DIR` override for tests), `newId()` (crypto.randomUUID), typed row interfaces, and query helpers: `insertBook/listBooks/getBook/updateBookStatus/deleteBook`, `insertPages/getPagesText(bookId, start, end)`, `insertCurriculum(bookId, modules)` (transaction), `getCurriculum(bookId)` (modules with lessons + per-lesson completion), `getLesson/updateLessonStatus/setLessonCompleted`, `saveMaterials/getMaterials`, `insertQuizAttempt/getQuizAttempts`, `insertTutorMessage/getTutorMessages`.

- [ ] Tests with `DATA_DIR=$(mktemp -d)`: insert book → curriculum tx → getCurriculum shape; getPagesText joins range with `\n\n`; cascade delete.
- [ ] `npm test` green. Commit.

### Task 5: PDF extraction

**Files:** Create `lib/pdf.ts`, `tests/pdf.test.ts`.

```ts
export interface ExtractedBook {
  title: string | null; author: string | null; numPages: number;
  pages: string[];                       // index 0 = page 1
  outline: { title: string; page: number | null }[]
}
export async function extractBook(buf: Uint8Array): Promise<ExtractedBook>
```

Use `getDocumentProxy`, `getMetadata` (Title/Author), `extractText(pdf, {mergePages:false})`. Outline: `pdf.getOutline()`; resolve each item's `dest` (string → `pdf.getDestination`, then `pdf.getPageIndex(dest[0])+1`); failures → `page: null`. Guard: if total text < 500 chars → throw `Error('NO_TEXT')` (scanned book).

- [ ] Test against the reference PDF (`it.skipIf` file missing): 214 pages, outline ≥ 10 items, outline pages resolve ascending.
- [ ] `npm test` green. Commit.

### Task 6: Curriculum, materials, tutor prompts + validation

**Files:** Create `lib/curriculum.ts`, `lib/materials.ts`, `lib/tutor.ts`, `tests/curriculum.test.ts`, `tests/materials.test.ts`.

Types:

```ts
// curriculum
interface CurriculumModule { title: string; description: string; lessons: { title: string; summary: string; pageStart: number; pageEnd: number }[] }
// materials
interface Slide { title: string; bullets: string[] }
interface Takeaway { point: string; detail: string }
interface QuizQuestion { question: string; choices: string[]; answerIndex: number; explanation: string }
interface LessonMaterials { slides: Slide[]; takeaways: Takeaway[]; quiz: QuizQuestion[] }
```

`generateCurriculum(book, pages, outline)`: prompt = role ("expert instructional designer"), book title/author/numPages, outline with resolved pages, per-page excerpts (first 150 chars each, `[p.N]` prefixed), instructions: 3–8 modules, 2–6 lessons each, lessons 4–25 pages, contiguous coverage of the instructional core (skip TOC/index/acknowledgments), strict JSON schema example, "Output ONLY JSON". → `extractJson` → `validateCurriculum` (clamps page ranges into [1,numPages], requires ≥1 module, ≥1 lesson, types). One retry on validation failure (append error to prompt).

`generateMaterials(lesson, lessonText)`: lessonText = page range joined, clipped 28k chars. One call → `{slides: 6–10, takeaways: 4–7, quiz: exactly 5 questions, 4 choices each}` JSON. `validateMaterials` checks shapes, `answerIndex ∈ [0,3]`. One retry.

`tutor.ts`: `buildTutorPrompt(lesson, materials, lessonText, history, question)` → `{system, prompt}`. System: patient tutor persona, grounded in THIS lesson (text embedded, clipped 20k), answer from the lesson first, say so when out of scope, concise markdown. Prompt: transcript of history + new question. Also `starterQuestions(materials)` → 3 suggested questions derived from takeaways.

- [ ] TDD validators: valid passes; missing fields, bad ranges, wrong quiz arity → throw; clamping works.
- [ ] `npm test` green. Commit.

### Task 7: Job queue

**Files:** Create `lib/jobs.ts`.

GlobalThis singleton `{ running: boolean; queue: Job[] }`; `enqueue(job)` + serial `drain()` (one LLM call at a time keeps CLI usage sane). Jobs:

- `processBook(bookId)`: stage `extracting` → read PDF from `data/uploads/<id>.pdf`, `extractBook`, store pages, update title/author/num_pages (keep upload-derived title if metadata empty); stage `analyzing` → `generateCurriculum`; stage `curriculum` → `insertCurriculum`; status `ready` → enqueue `generateLesson` for every lesson in order. Catch → status `error` + message.
- `generateLesson(lessonId, priority?)`: skip unless status `pending`/`error`; set `generating`; `getPagesText` → `generateMaterials` → `saveMaterials` → `ready`. Catch → `error`. `priority` unshifts the job (lesson the user just opened).

- [ ] Verify via Task 8 integration + E2E (no isolated unit test; logic is glue). Commit with Task 8.

### Task 8: API routes

**Files:** Create under `app/api/`:

- `books/route.ts` — POST multipart (`file`, max 80MB, must be .pdf): save to `data/uploads/<id>.pdf`, insert book (title from filename, accent = hash of id), enqueue `processBook`, return book. GET: list books with progress (`completedLessons/totalLessons`).
- `books/[bookId]/route.ts` — GET: book + curriculum (modules→lessons with status/completed) + stage. DELETE: remove book row (cascades) + uploaded file.
- `lessons/[lessonId]/route.ts` — GET: lesson + materials (if ready) + attempts; side-effect: if status `pending`/`error`, enqueue priority generation (idempotent).
- `lessons/[lessonId]/complete/route.ts` — POST `{completed: boolean}`.
- `lessons/[lessonId]/quiz/route.ts` — POST `{answers: number[]}` → grade server-side from stored quiz, insert attempt, return `{score,total,results[]}`.
- `lessons/[lessonId]/tutor/route.ts` — GET history. POST `{question}`: persist user msg, build prompt, return `text/event-stream` from `llm.stream()`; on completion persist assistant msg. SSE frames: `data: {"text": "..."}\n\n`, final `data: {"done": true}\n\n`.

All routes `export const runtime = 'nodejs'` and `dynamic = 'force-dynamic'`.

- [ ] Integration smoke: `npm run dev` + `curl` upload reference book → poll GET book until `ready` → GET first lesson until materials → POST quiz → tutor POST streams. Commit.

### Task 9: UI foundation + Library page

**Files:** Modify `app/layout.tsx`, `app/globals.css`, `app/page.tsx`; create `components/*` as needed.

Apply **frontend-design skill**. Direction (from spec): calm scholarly aesthetic — warm paper bg, ink text, serif display (next/font: Fraunces or Newsreader) + sans (Inter), per-book accent from `accent` seed; smooth micro-transitions; polished empty/loading/error states.

Acceptance:
- [ ] Library shows book cards (title, author, progress, accent), drag-drop + click upload with client-side .pdf check
- [ ] Uploading → card appears in `processing` state with staged label (extracting/analyzing/curriculum) via 1.5s polling; error state shows message + delete
- [ ] Empty state invites first upload. Build passes. Commit.

### Task 10: Book curriculum page

**Files:** Create `app/books/[bookId]/page.tsx` + components.

Acceptance:
- [ ] Modules as sections with description; lesson rows: position, title, summary, page range, status chip (ready/generating/pending/error), completion check
- [ ] Overall progress bar + "Continue studying" CTA → next incomplete lesson
- [ ] Lessons clickable regardless of status (lesson page handles generating state); polling while any lesson not ready; back nav to library. Commit.

### Task 11: Lesson workspace

**Files:** Create `app/books/[bookId]/lessons/[lessonId]/page.tsx`, `components/slides.tsx`, `components/quiz.tsx`, `components/tutor.tsx`, `components/takeaways.tsx`.

Acceptance:
- [ ] Header: lesson title, module, page range, prev/next lesson, Mark complete toggle (persists)
- [ ] Tabs: Slides / Takeaways / Quiz / Tutor (URL-stable via `?tab=`)
- [ ] Slides: card deck, arrow-key + button nav, progress dots, slide counter
- [ ] Takeaways: numbered scannable list (point bold, detail below)
- [ ] Quiz: one question at a time, select → immediate correct/incorrect + explanation, next; final score screen + retake; attempt POSTed
- [ ] Tutor: history loads, starter question chips, streamed assistant replies (SSE), markdown rendering, error bubble + retry
- [ ] Generating state: friendly skeleton + status polling until ready. Commit.

### Task 12: End-to-end verification (real book)

- [ ] **webapp-testing skill** + Playwright: full journey with the reference PDF — upload → processing stages → curriculum renders → open lesson 1 → slides/takeaways/quiz interactions → tutor question gets grounded streamed answer → mark complete → progress reflects on book + library pages
- [ ] Fix everything found; re-run until clean. Commit.

### Task 13: Docs + wrap-up

- [ ] README: what it is, `npm install && npm run dev`, requirements (claude CLI logged in OR ANTHROPIC_API_KEY), data layout, env vars (`LLM_MODEL`, `DATA_DIR`)
- [ ] `npm run build && npm test` final green. Commit.

## Self-review

- Spec coverage: upload→T1/T8, curriculum→T6/T7, slides/takeaways/quiz→T6/T11, tutor→T6/T8/T11, smooth UX→T9–T11, error handling→T5 guard/T7 catches/T9 error states, testing→T2–T6 unit + T12 e2e. No gaps.
- Placeholders: none (UI tasks intentionally carry acceptance criteria, per granularity note).
- Type consistency: `LessonMaterials`/`CurriculumModule` defined T6, consumed T7/T8/T11; `LlmProvider` defined T3, consumed T6/T8. Consistent.
