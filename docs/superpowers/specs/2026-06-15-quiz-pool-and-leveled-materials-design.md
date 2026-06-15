# Quiz pool + level-aware materials — design

Date: 2026-06-15

## 1. Goal

Two coupled changes to lesson-material generation:

1. **Level-aware materials.** Pitch the **takeaways** and **quiz** at the same default
   learner level already applied to slides (`DEFAULT_AUDIENCE_LEVEL` —
   "first-year university student", a placeholder until a user/auth module exists).
2. **Quiz becomes a question *pool*.** Instead of a fixed 5 questions, generate enough
   questions to cover the whole section. On the quiz page the learner picks how many
   questions they want; the app draws that many from the pool and runs them.

Slides are out of scope here (already leveled and autofit-fixed). Takeaways keep their
current 4–7 count; only their wording is leveled.

## 2. Why these specific decisions

This design incorporates corrections from an engineering review. The non-obvious
decisions and their justifications:

- **Stratified sampling, not uniform.** The pool is generated for *coverage* (≈1–2
  questions per concept). A uniform random draw of N from the pool can cluster on one
  concept and miss others, defeating the coverage we paid to generate. Each question
  therefore carries a `concept` tag and selection is stratified round-robin across
  concepts, so any N is a maximally-spread subset.
- **"Best" ranked by Wilson lower bound, not raw percentage.** Attempts now vary in size
  (N differs per attempt). Raw percentage is a biased "best" metric: small-N attempts have
  lower variance and are far easier to ace (5/5 would outrank 18/20). We rank attempts by
  the Wilson score interval lower bound of accuracy (penalizes small N correctly) and
  display the winning attempt's plain `score/total (pct%)`.
- **Soft pool target, low hard floor.** The pool *target* is 8–30, but validation must not
  hard-reject pools below 8 — a sparse section with only ~4 testable concepts would
  otherwise fail generation and error the lesson. Hard minimum stays at 3 (today's
  behavior); the upper bound is enforced by **truncation**, not rejection.
- **Explicit `question_indexes` column, not a polymorphic blob.** Recording which pool
  questions an attempt used must not overload the existing `answers` column with a second
  JSON shape. A dedicated nullable column keeps each column single-typed; legacy rows are
  `NULL` (unambiguously "the whole quiz, in order").
- **Pure, injectable-RNG selection logic.** Selection/scoring helpers live in a pure
  `lib/quiz.ts` module with an injectable RNG so they are property-testable, matching the
  repo's existing discipline (`lib/deck.ts`, `lib/math.ts` are pure and vitest-covered).
- **Stop polling once the lesson is terminal.** `usePoll` currently refetches the entire
  materials payload every 2.5s for the whole session. The enlarged quiz pool (up to ~30
  questions with explanations + answers) plus the now-detailed deck makes this wasteful for
  immutable data. Polling is gated to run only while the lesson is still generating.

## 3. Data model

### 3.1 `QuizQuestion` (lib/db.ts)

```ts
export interface QuizQuestion {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  concept?: string; // short topic label for stratified sampling; optional for back-compat
}
```

`concept` is **optional in the type** so legacy stored quizzes (no concept) still parse.
Fresh generation **requires** a non-empty `concept` (enforced in `validateQuiz`, not at the
type level). `selectQuestions` treats a missing/blank concept as its own singleton stratum,
so legacy quizzes degrade gracefully to uniform selection.

### 3.2 `quiz_attempts` table (lib/db.ts)

Add one nullable column via the existing `migrate(db)` path:

```sql
ALTER TABLE quiz_attempts ADD COLUMN question_indexes TEXT; -- JSON number[]; NULL = legacy full quiz
```

```ts
export interface QuizAttemptRow {
  id: string;
  lesson_id: string;
  score: number;
  total: number;
  answers: string;             // JSON number[] of picked choice indices (-1 = skipped), unchanged
  question_indexes: string | null; // JSON number[] of pool indices asked, in order; NULL for legacy
  created_at: string;
}
```

`insertQuizAttempt(lessonId, score, total, answers, questionIndexes)` gains the
`questionIndexes: number[]` parameter and writes it as JSON.

`LessonMaterials` shape is unchanged (`{ slides, takeaways, quiz }`).

## 4. Generation (lib/materials.ts + new lib/quiz.ts)

Generation becomes **two LLM calls**, orchestrated by `generateMaterials`. If either call
fails after its own retries, the whole lesson generation fails (status `error`) — atomic,
matching today. `lib/jobs.ts` is unchanged.

### 4.1 Call A — slides + takeaways (lib/materials.ts)

- `buildMaterialsPrompt` drops the quiz: the `quiz` key and its JSON example are removed
  from the output schema, and the numbered instruction list loses item 3.
- Takeaways instruction gains: pitch each takeaway for `DEFAULT_AUDIENCE_LEVEL`.
- `validateMaterials` is split: `validateLessonContent` validates `{ slides, takeaways }`
  only.

> Module split for client-safety: `lib/quiz.ts` holds only **pure** logic (`buildQuizPrompt`,
> `validateQuiz`, `gradeAttempt`, `selectQuestions`, `wilsonLowerBound`, `bestAttempt`,
> `quizCountPresets`) so the quiz component can import the selection/scoring helpers. The
> LLM-calling `generateQuiz` lives in `lib/materials.ts` (server-only, next to
> `generateMaterials`), since importing `getLlm` into a client-imported module would pull
> Node-only providers into the browser bundle.

### 4.2 Call B — quiz pool (`buildQuizPrompt`/`validateQuiz` in lib/quiz.ts; `generateQuiz` in lib/materials.ts)

- `buildQuizPrompt(lesson, lessonText)`: grounded only in the source text; applies
  `MATH_INSTRUCTION` and `DEFAULT_AUDIENCE_LEVEL`. Instruction:
  > Write a pool of multiple-choice questions that **covers the whole section** — roughly
  > one or two questions per distinct concept. Aim for **8 to 30** questions depending on
  > how much the section covers. Each question: a `concept` (short topic label it tests), a
  > `question`, exactly 4 plausible `choices`, the 0-based `answerIndex`, and a 1–2 sentence
  > `explanation`. Test understanding, not trivia. Pitch every question for
  > {DEFAULT_AUDIENCE_LEVEL}.
- `validateQuiz(raw)`:
  - quiz is an array, length **≥ 3** (hard floor; 8 is only a prompt target).
  - if length **> 30**, **truncate** to the first 30 (no rejection).
  - each question: non-empty `question`, non-empty `concept`, **≥ 2** string `choices`,
    integer `answerIndex` in `[0, choices.length)`, optional `explanation` string.
  - The prompt asks for *exactly 4* choices, but validation stays lenient at ≥ 2 (matching
    today's `validateMaterials`) to tolerate model variance rather than error the lesson.
- Two-attempt retry with an error nudge, mirroring `generateMaterials` today.

### 4.3 Orchestration

```ts
export async function generateMaterials(lesson, lessonText): Promise<LessonMaterials> {
  const { slides, takeaways } = await generateLessonContent(lesson, lessonText); // call A
  const quiz = await generateQuiz(lesson, lessonText);                            // call B
  return { slides, takeaways, quiz };
}
```

Coverage is **best-effort**: the prompt targets per-concept coverage but the system does
not formally verify it. No coverage-critic pass in this version.

## 5. Selection + scoring helpers (lib/quiz.ts, pure)

```ts
// Stratified round-robin sample of `count` questions from `pool`.
// Returns original-pool indices, in randomized presentation order.
export function selectQuestions(
  pool: QuizQuestion[],
  count: number,
  rng: () => number = Math.random,
): number[];
```

Algorithm:
1. `count = clamp(count, 1, pool.length)`.
2. Group question indices by `concept` (questions with blank/missing concept each form
   their own singleton group). Preserve first-appearance order of groups.
3. Shuffle indices within each group and shuffle group order (Fisher–Yates with `rng`).
4. Round-robin: take one index from each non-empty group in turn until `count` collected.
5. Shuffle the collected list once more for presentation order; return it.

Invariants (property-tested): every returned index is in `[0, pool.length)`; no duplicates;
`length === clamp(count, 1, pool.length)`; when `count >= pool.length` it is a permutation
of all indices; concept spread is maximal for the given `count`.

```ts
// Wilson score interval lower bound of accuracy; z=1.96 (95%). total=0 -> 0.
export function wilsonLowerBound(correct: number, total: number, z?: number): number;

// Index of the attempt with the highest Wilson lower bound, or null if none.
export function bestAttempt(attempts: { score: number; total: number }[]): number | null;
```

```ts
// Presets for the count picker, given pool size N.
// presets = [5,10,20].filter(p => p < N) then append { label: `All (${N})`, value: N }.
// default = N >= 10 ? 10 : N.
export function quizCountPresets(poolSize: number): {
  options: { label: string; value: number }[];
  defaultValue: number;
};
```

## 6. Quiz page UX (components/quiz.tsx)

Three phases: `setup` → `quiz` → `result`.

- **setup** (new): "How many questions?" with preset buttons from `quizCountPresets(pool.length)`
  (e.g. `5 / 10 / 20 / All (24)`), the default preselected. Shows prior performance:
  best attempt via `bestAttempt` rendered as `best 17/20 (85%)`, plus attempt count.
  On start: `selected = selectQuestions(quiz, chosenCount)`; phase → `quiz`.
- **quiz**: the existing one-question-at-a-time flow, iterating over `selected`
  (`quiz[selected[i]]`). Unchanged interaction (pick → reveal → next).
- On finish, POST `{ questions: selected, answers }` (see §7). phase → `result`.
- **result**: unchanged layout, but iterates `selected` and aligns `result.results[i]`.
  "Retake quiz" returns to **setup** (so the learner can change the count).

The full pool (including `answerIndex`/`explanation`) is already shipped to the client today;
this is unchanged. Selection and grading are client-trusted, consistent with the current
study-tool model (no change to the trust boundary).

## 7. Grading + attempts (app/api/lessons/[lessonId]/quiz/route.ts)

New request contract: `{ questions: number[], answers: number[] }`.

- `questions`: pool indices asked, in order. Validate: array of integers, each in
  `[0, materials.quiz.length)`, **no duplicates**, length ≥ 1.
- `answers`: picked choice indices aligned to `questions`. Validate: array of integers,
  `answers.length === questions.length`, each in `[-1, choices.length)` for its question
  (`-1` = skipped → incorrect).
- The old `answers.length !== materials.quiz.length` check is **removed**.
- Grade via the pure `gradeAttempt(pool, questions, answers)` (lib/quiz.ts), which performs
  the validation above and returns `{ score, total, results }`. The route is a thin wrapper:
  it catches `gradeAttempt`'s errors as HTTP 400.
- Persist: `insertQuizAttempt(lessonId, score, total, answers, questions)`.
- Response unchanged in shape: `{ score, total, results: [{ correct, answerIndex, explanation }] }`
  aligned to asked order.

Malformed bodies return HTTP 400 before any indexing, so `quiz[questions[i]]` can never
throw.

## 8. Polling fix (components/lesson.tsx)

Stop polling once the lesson is `ready` (only). Update `setActive` from a `useEffect` so the
control runs after render, not during it:

```ts
const { data, error, refresh, setActive } = usePoll(`/api/lessons/${lessonId}`, 2500, true);
useEffect(() => {
  setActive(!data || data.lesson.status !== "ready");
}, [data, setActive]);
```

Materials are immutable once `ready`; the mutation paths (slide revise, deck customize,
quiz grade) already call `refresh()` directly, so manual refresh continues to work after the
interval stops. **Keep polling on `error`**: the lesson GET route re-enqueues a `pending`/`error`
lesson on each request, so the poll is what drives the automatic retry that the error-state copy
("Folio is retrying now — this page will refresh itself") promises. The heavy payload only
exists once `ready`, so stopping there captures the savings without breaking retry.

## 9. Backward compatibility

- Legacy lessons keep their stored 5-question quiz (no `concept`). The picker caps at the
  pool size; `selectQuestions` degrades to uniform when concepts are absent.
- Legacy `quiz_attempts` rows have `question_indexes = NULL`, interpreted as "full quiz, in
  order". Display code only ever reads `score`/`total`, so legacy rows render unchanged.
- No data migration beyond the additive `question_indexes` column.

## 10. Files touched

- `lib/db.ts` — `QuizQuestion.concept?`; `quiz_attempts.question_indexes` column +
  migration; `QuizAttemptRow.question_indexes`; `insertQuizAttempt` signature.
- `lib/materials.ts` — drop quiz from prompt/validation; level takeaways; split into
  `generateLessonContent` + orchestrating `generateMaterials`; add server-only `generateQuiz`.
- `lib/quiz.ts` (new, pure/client-safe) — `buildQuizPrompt`, `validateQuiz`, `gradeAttempt`,
  `selectQuestions`, `wilsonLowerBound`, `bestAttempt`, `quizCountPresets`.
- `app/api/lessons/[lessonId]/quiz/route.ts` — new contract, exhaustive validation, subset
  grading, store indices.
- `components/quiz.tsx` — setup phase, presets, sampled run, Wilson-based best display.
- `components/lesson.tsx` — gate polling on lesson liveness.
- Tests — `tests/quiz.test.ts` (new): `validateQuiz` (floor/cap/concept/choices),
  `selectQuestions` (property tests for the invariants in §5), `wilsonLowerBound`/
  `bestAttempt` (known values + small-N bias), `quizCountPresets` (edge pool sizes).
  Update `tests/materials.test.ts` for the quiz-less content prompt/validation.

## 11. Testing plan

- **Pure unit/property tests** for everything in `lib/quiz.ts` (selection invariants,
  Wilson values, preset edges incl. pool sizes 4, 5, 8, 10, 24, 30).
- **Validation tests**: `validateQuiz` rejects <3, truncates >30, requires `concept` and
  4-choice/valid-`answerIndex`.
- **Manual/browser**: generate a lesson, confirm pool size scales with section length,
  pick each preset, verify stratified spread and grading/score; confirm polling stops after
  `ready` (network panel).

## 12. Out of scope

- Slides (done separately).
- Per-user knowledge level (awaiting auth; `DEFAULT_AUDIENCE_LEVEL` is the placeholder).
- Quiz regeneration UI and a formal coverage-verification pass.
- Cross-attempt repeat avoidance (large pool + stratified draw already give variety).
