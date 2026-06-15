# Quiz Pool + Level-Aware Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a coverage-sized *pool* of level-appropriate quiz questions (and leveled takeaways), and let the learner pick how many questions to take from a stratified random sample.

**Architecture:** Generation splits into two LLM calls — slides+takeaways (existing prompt, minus quiz) and a new quiz-pool call. All pure quiz logic (prompt builder, validation, grading, stratified selection, Wilson scoring, count presets) lives in a new client-safe `lib/quiz.ts`; the LLM-calling `generateQuiz` lives server-side in `lib/materials.ts`. The quiz page gains a "how many questions?" setup step that draws a stratified sample from the pool; grading accepts the chosen subset and records which pool questions were asked.

**Tech Stack:** Next.js 16 (App Router) / React 19, TypeScript, better-sqlite3, vitest. Spec: `docs/superpowers/specs/2026-06-15-quiz-pool-and-leveled-materials-design.md`.

---

## File Structure

- **`lib/quiz.ts`** (new, pure/client-safe — no Node imports): `wilsonLowerBound`, `bestAttempt`, `quizCountPresets`, `selectQuestions`, `validateQuiz`, `gradeAttempt`, `buildQuizPrompt`. Imports only `type QuizQuestion` from `./db`, `DEFAULT_AUDIENCE_LEVEL` from `./deck`, `MATH_INSTRUCTION` from `./math`.
- **`lib/materials.ts`** (modify, server-only): drop quiz from the prompt; rename `validateMaterials` → `validateLessonContent` (slides+takeaways only); level takeaways; add `generateQuiz`; `generateMaterials` orchestrates both calls.
- **`lib/db.ts`** (modify): `QuizQuestion.concept?`; `QuizAttemptRow.question_indexes`; migration to add the column; `insertQuizAttempt` gains `questionIndexes`.
- **`app/api/lessons/[lessonId]/quiz/route.ts`** (modify): new request contract; delegates to `gradeAttempt`; stores indices.
- **`components/quiz.tsx`** (modify): setup → quiz → result phases; stratified sample; Wilson-based "best".
- **`components/lesson.tsx`** (modify): gate polling on lesson liveness.
- **`tests/quiz.test.ts`** (new): pure-logic tests. **`tests/materials.test.ts`** (modify): content-only validation.

**Test command (whole suite):** `npm test` · **Single file:** `npx vitest run tests/quiz.test.ts`

---

## Task 1: Wilson scoring helpers (`wilsonLowerBound`, `bestAttempt`)

**Files:**
- Create: `lib/quiz.ts`
- Test: `tests/quiz.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/quiz.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wilsonLowerBound, bestAttempt } from "@/lib/quiz";

describe("wilsonLowerBound", () => {
  it("returns 0 for no attempts", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("penalizes small samples (a perfect 5 ranks below a perfect 20)", () => {
    expect(wilsonLowerBound(5, 5)).toBeCloseTo(0.566, 2);
    expect(wilsonLowerBound(10, 10)).toBeCloseTo(0.722, 2);
    expect(wilsonLowerBound(20, 20)).toBeCloseTo(0.839, 2);
    expect(wilsonLowerBound(18, 20)).toBeCloseTo(0.699, 2);
  });
});

describe("bestAttempt", () => {
  it("returns null with no attempts", () => {
    expect(bestAttempt([])).toBeNull();
  });

  it("prefers the higher Wilson lower bound, not the higher raw percentage", () => {
    // 5/5 = 100% but Wilson 0.566; 18/20 = 90% but Wilson 0.699 -> index 1 wins.
    expect(bestAttempt([{ score: 5, total: 5 }, { score: 18, total: 20 }])).toBe(1);
    // A perfect 10 (0.722) still beats 18/20 (0.699).
    expect(bestAttempt([{ score: 10, total: 10 }, { score: 18, total: 20 }])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/quiz"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/quiz.ts`:

```ts
import type { QuizQuestion } from "./db";

/** Wilson score interval lower bound of accuracy (z=1.96 ≈ 95%). total=0 -> 0. */
export function wilsonLowerBound(correct: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const phat = correct / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

/** Index of the attempt with the highest Wilson lower bound; null if none. */
export function bestAttempt(
  attempts: { score: number; total: number }[]
): number | null {
  let best: number | null = null;
  let bestLb = -1;
  attempts.forEach((a, i) => {
    const lb = wilsonLowerBound(a.score, a.total);
    if (lb > bestLb) {
      bestLb = lb;
      best = i;
    }
  });
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts tests/quiz.test.ts
git commit -m "feat(quiz): Wilson lower-bound scoring helpers"
```

---

## Task 2: Count presets + stratified selection (`quizCountPresets`, `selectQuestions`)

**Files:**
- Modify: `lib/quiz.ts`
- Test: `tests/quiz.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/quiz.test.ts`:

```ts
import { quizCountPresets, selectQuestions } from "@/lib/quiz";
import type { QuizQuestion } from "@/lib/db";

// Deterministic RNG for reproducible selection tests.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePool(concepts: string[]): QuizQuestion[] {
  return concepts.map((c, i) => ({
    question: `q${i}`,
    choices: ["a", "b", "c", "d"],
    answerIndex: 0,
    explanation: "",
    concept: c,
  }));
}

describe("quizCountPresets", () => {
  it("offers presets below the pool size plus All, defaulting to 10", () => {
    expect(quizCountPresets(24)).toEqual({
      options: [
        { label: "5", value: 5 },
        { label: "10", value: 10 },
        { label: "20", value: 20 },
        { label: "All (24)", value: 24 },
      ],
      defaultValue: 10,
    });
  });

  it("collapses to just All when the pool is small, defaulting to the pool size", () => {
    expect(quizCountPresets(5)).toEqual({
      options: [{ label: "All (5)", value: 5 }],
      defaultValue: 5,
    });
    expect(quizCountPresets(8).defaultValue).toBe(8);
    expect(quizCountPresets(8).options).toEqual([
      { label: "5", value: 5 },
      { label: "All (8)", value: 8 },
    ]);
  });
});

describe("selectQuestions", () => {
  const pool = makePool([
    "A", "A", "A", "B", "B", "B", "C", "C", "C", // 9 questions, 3 concepts
  ]);

  it("returns the requested count, in range, with no duplicates", () => {
    const picked = selectQuestions(pool, 5, mulberry32(1));
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    for (const i of picked) expect(i).toBeGreaterThanOrEqual(0);
    for (const i of picked) expect(i).toBeLessThan(pool.length);
  });

  it("clamps the count to the pool size and returns a permutation when count >= pool", () => {
    const picked = selectQuestions(pool, 99, mulberry32(2));
    expect([...picked].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("spreads across concepts first (3 picks -> 3 distinct concepts)", () => {
    const picked = selectQuestions(pool, 3, mulberry32(3));
    const concepts = new Set(picked.map((i) => pool[i].concept));
    expect(concepts.size).toBe(3);
  });

  it("handles a pool with no concepts (legacy) without throwing", () => {
    const legacy: QuizQuestion[] = [0, 1, 2, 3].map((i) => ({
      question: `q${i}`, choices: ["a", "b"], answerIndex: 0, explanation: "",
    }));
    const picked = selectQuestions(legacy, 2, mulberry32(4));
    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
  });

  it("returns [] for an empty pool", () => {
    expect(selectQuestions([], 5, mulberry32(5))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz.test.ts`
Expected: FAIL — `quizCountPresets`/`selectQuestions` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/quiz.ts`:

```ts
/** Preset choices for the "how many questions?" picker, given the pool size. */
export function quizCountPresets(poolSize: number): {
  options: { label: string; value: number }[];
  defaultValue: number;
} {
  const options = [5, 10, 20]
    .filter((p) => p < poolSize)
    .map((p) => ({ label: String(p), value: p }));
  options.push({ label: `All (${poolSize})`, value: poolSize });
  return { options, defaultValue: poolSize >= 10 ? 10 : poolSize };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Stratified random sample of `count` questions from `pool`. Groups by concept
 * (blank/missing concept => its own singleton stratum) and round-robins across
 * groups, so any count is spread across as many concepts as possible. Returns
 * original-pool indices in randomized presentation order.
 */
export function selectQuestions(
  pool: QuizQuestion[],
  count: number,
  rng: () => number = Math.random
): number[] {
  if (pool.length === 0) return [];
  const n = Math.max(1, Math.min(Math.floor(count) || 1, pool.length));

  const groups = new Map<string, number[]>();
  pool.forEach((q, i) => {
    const key = q.concept && q.concept.trim() ? q.concept.trim() : `__solo_${i}`;
    const existing = groups.get(key);
    if (existing) existing.push(i);
    else groups.set(key, [i]);
  });

  const buckets = shuffle(
    [...groups.values()].map((g) => shuffle(g, rng)),
    rng
  );

  const picked: number[] = [];
  let progress = true;
  while (picked.length < n && progress) {
    progress = false;
    for (const bucket of buckets) {
      if (bucket.length === 0) continue;
      picked.push(bucket.pop() as number);
      progress = true;
      if (picked.length >= n) break;
    }
  }
  return shuffle(picked, rng);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts tests/quiz.test.ts
git commit -m "feat(quiz): count presets and stratified question selection"
```

---

## Task 3: Quiz validation (`validateQuiz`)

**Files:**
- Modify: `lib/quiz.ts`
- Test: `tests/quiz.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/quiz.test.ts`:

```ts
import { validateQuiz } from "@/lib/quiz";

const q = (over: Partial<QuizQuestion> = {}): Record<string, unknown> => ({
  concept: "Spin",
  question: "How many outcomes?",
  choices: ["One", "Two", "Three", "Four"],
  answerIndex: 1,
  explanation: "Binary.",
  ...over,
});

describe("validateQuiz", () => {
  it("accepts a valid pool and trims strings", () => {
    const out = validateQuiz([q(), q(), q()]);
    expect(out).toHaveLength(3);
    expect(out[0].concept).toBe("Spin");
    expect(out[0].answerIndex).toBe(1);
  });

  it("rejects fewer than 3 questions", () => {
    expect(() => validateQuiz([q(), q()])).toThrow();
  });

  it("truncates pools larger than 30", () => {
    const big = Array.from({ length: 35 }, () => q());
    expect(validateQuiz(big)).toHaveLength(30);
  });

  it("requires a concept on every question", () => {
    expect(() => validateQuiz([q(), q(), q({ concept: "" })])).toThrow(/concept/);
  });

  it("rejects an out-of-range answerIndex", () => {
    expect(() => validateQuiz([q(), q(), q({ answerIndex: 9 })])).toThrow();
  });

  it("rejects fewer than 2 choices", () => {
    expect(() => validateQuiz([q(), q(), q({ choices: ["only"] })])).toThrow();
  });

  it("rejects non-array input", () => {
    expect(() => validateQuiz("nope")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz.test.ts`
Expected: FAIL — `validateQuiz` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/quiz.ts`:

```ts
const QUIZ_HARD_MIN = 3;
const QUIZ_MAX = 30;

function quizFail(message: string): never {
  throw new Error(`Quiz invalid: ${message}`);
}

/**
 * Validate a freshly generated quiz pool. The 8-question target is enforced only
 * in the prompt; here the hard floor stays low (3) so sparse sections don't error,
 * and oversized pools are truncated rather than rejected.
 */
export function validateQuiz(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) quizFail("expected an array of questions");
  if (raw.length < QUIZ_HARD_MIN)
    quizFail(`need at least ${QUIZ_HARD_MIN} questions`);
  return raw.slice(0, QUIZ_MAX).map((item, i) => {
    const o = (typeof item === "object" && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    const question = typeof o.question === "string" ? o.question.trim() : "";
    if (!question) quizFail(`question ${i} text missing`);
    const concept = typeof o.concept === "string" ? o.concept.trim() : "";
    if (!concept) quizFail(`question ${i} concept missing`);
    const choices = o.choices;
    if (
      !Array.isArray(choices) ||
      choices.length < 2 ||
      !choices.every((c) => typeof c === "string")
    )
      quizFail(`question ${i} needs 2+ string choices`);
    const answerIndex = o.answerIndex;
    if (
      typeof answerIndex !== "number" ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= (choices as string[]).length
    )
      quizFail(`question ${i} answerIndex out of range`);
    return {
      concept,
      question,
      choices: (choices as string[]).map((c) => c.trim()),
      answerIndex,
      explanation: typeof o.explanation === "string" ? o.explanation.trim() : "",
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts tests/quiz.test.ts
git commit -m "feat(quiz): validateQuiz with soft target, hard floor, truncation"
```

---

## Task 4: Subset grading (`gradeAttempt`)

**Files:**
- Modify: `lib/quiz.ts`
- Test: `tests/quiz.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/quiz.test.ts`:

```ts
import { gradeAttempt } from "@/lib/quiz";

describe("gradeAttempt", () => {
  const pool = [
    q({ answerIndex: 1 }),
    q({ answerIndex: 2 }),
    q({ answerIndex: 0 }),
  ].map((o) => validateQuiz([o, q(), q()])[0]); // each becomes a valid QuizQuestion

  it("scores a subset in the asked order", () => {
    const out = gradeAttempt(pool, [2, 0], [0, 1]); // q2 correct(0), q0 correct(1)
    expect(out.total).toBe(2);
    expect(out.score).toBe(2);
    expect(out.results[0]).toEqual({ correct: true, answerIndex: 0, explanation: "Binary." });
  });

  it("counts a skipped answer (-1) as incorrect", () => {
    const out = gradeAttempt(pool, [0], [-1]);
    expect(out.score).toBe(0);
    expect(out.results[0].correct).toBe(false);
  });

  it("throws on length mismatch", () => {
    expect(() => gradeAttempt(pool, [0, 1], [0])).toThrow();
  });

  it("throws on duplicate question index", () => {
    expect(() => gradeAttempt(pool, [0, 0], [0, 0])).toThrow(/duplicate/);
  });

  it("throws on out-of-range question index", () => {
    expect(() => gradeAttempt(pool, [99], [0])).toThrow();
  });

  it("throws on out-of-range answer", () => {
    expect(() => gradeAttempt(pool, [0], [9])).toThrow();
  });

  it("throws on empty submission", () => {
    expect(() => gradeAttempt(pool, [], [])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz.test.ts`
Expected: FAIL — `gradeAttempt` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/quiz.ts`:

```ts
export interface GradedResult {
  correct: boolean;
  answerIndex: number;
  explanation: string;
}

export interface GradedAttempt {
  score: number;
  total: number;
  results: GradedResult[];
}

/**
 * Grade a subset of the pool. `questions` are pool indices in asked order;
 * `answers` are the picked choice indices (-1 = skipped). Throws on any malformed
 * input so callers can map the error to a 400 before indexing the pool.
 */
export function gradeAttempt(
  pool: QuizQuestion[],
  questions: number[],
  answers: number[]
): GradedAttempt {
  if (!Array.isArray(questions) || !Array.isArray(answers))
    throw new Error("questions and answers must be arrays");
  if (questions.length === 0) throw new Error("no questions submitted");
  if (questions.length !== answers.length)
    throw new Error("questions and answers length mismatch");

  const seen = new Set<number>();
  for (const qi of questions) {
    if (!Number.isInteger(qi) || qi < 0 || qi >= pool.length)
      throw new Error("question index out of range");
    if (seen.has(qi)) throw new Error("duplicate question index");
    seen.add(qi);
  }

  const results = questions.map((qi, i) => {
    const question = pool[qi];
    const answer = answers[i];
    if (
      !Number.isInteger(answer) ||
      answer < -1 ||
      answer >= question.choices.length
    )
      throw new Error("answer out of range");
    return {
      correct: answer === question.answerIndex,
      answerIndex: question.answerIndex,
      explanation: question.explanation,
    };
  });

  return {
    score: results.filter((r) => r.correct).length,
    total: questions.length,
    results,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts tests/quiz.test.ts
git commit -m "feat(quiz): pure subset grading with exhaustive validation"
```

---

## Task 5: Quiz prompt builder (`buildQuizPrompt`)

**Files:**
- Modify: `lib/quiz.ts`
- Test: `tests/quiz.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/quiz.test.ts`:

```ts
import { buildQuizPrompt } from "@/lib/quiz";

describe("buildQuizPrompt", () => {
  it("includes source, concept field, level, and the JSON schema", () => {
    const p = buildQuizPrompt(
      { title: "Spin", summary: "first quantum surprise" },
      "[p.12] Spin is measured along an axis."
    );
    expect(p).toContain("[p.12] Spin is measured");
    expect(p).toContain('"concept"');
    expect(p).toContain("first-year university student"); // DEFAULT_AUDIENCE_LEVEL
    expect(p).toContain("COVER THE WHOLE SECTION");
    expect(p).toContain('{ "quiz":');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz.test.ts`
Expected: FAIL — `buildQuizPrompt` not exported.

- [ ] **Step 3: Write minimal implementation**

Add imports at the top of `lib/quiz.ts` (below the existing `QuizQuestion` import):

```ts
import { DEFAULT_AUDIENCE_LEVEL } from "./deck";
import { MATH_INSTRUCTION } from "./math";
```

Append to `lib/quiz.ts`:

```ts
const MAX_QUIZ_SOURCE_CHARS = 28_000;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n[...truncated]" : text;
}

export function buildQuizPrompt(
  lesson: { title: string; summary: string | null },
  lessonText: string
): string {
  return `You are an expert teacher writing a quiz question bank for one lesson.

LESSON: "${lesson.title}"${lesson.summary ? ` — ${lesson.summary}` : ""}

SOURCE TEXT (from the book, this lesson's pages, with [p.N] page markers):
---
${truncate(lessonText, MAX_QUIZ_SOURCE_CHARS)}
---

Write a POOL of multiple-choice questions grounded ONLY in the source text that together COVER THE WHOLE SECTION — roughly one or two questions per distinct concept. Aim for 8 to 30 questions depending on how much the section covers; do not pad with trivia.

Each question is an object with:
- "concept": a short label (2-4 words) for the idea it tests, so related questions can be grouped.
- "question": the question stem.
- "choices": exactly 4 plausible options (strings).
- "answerIndex": the 0-based index of the correct choice.
- "explanation": 1-2 sentences on why that answer is correct.

Test understanding, not recall of trivia. ${MATH_INSTRUCTION}

LEARNER — pitch every question for ${DEFAULT_AUDIENCE_LEVEL}

Output ONLY this JSON, no other text:
{ "quiz": [ { "concept": "...", "question": "...", "choices": ["...", "...", "...", "..."], "answerIndex": 0, "explanation": "..." } ] }`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts tests/quiz.test.ts
git commit -m "feat(quiz): leveled quiz-pool prompt builder"
```

---

## Task 6: DB schema — concept field, attempt indexes, migration

**Files:**
- Modify: `lib/db.ts` (interfaces near `:67` and `:79`; `migrate` at `:181-186`; `insertQuizAttempt` at `:405-416`)
- Test: `tests/db.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block at the end of `tests/db.test.ts`. The file uses a module-level dynamic import (`let db: typeof import("@/lib/db")`, assigned in `beforeAll`) and seeds a lesson via `insertBook` + `insertCurriculum`, so reuse `db.` and that pattern:

```ts
describe("quiz attempts store selected pool indices", () => {
  it("round-trips question_indexes as JSON", () => {
    const bookId = db.newId();
    db.insertBook({ id: bookId, title: "Quiz Book", author: null, filename: "q.pdf" });
    db.insertCurriculum(bookId, [
      { title: "M1", description: "", lessons: [{ title: "L", summary: "", pageStart: 1, pageEnd: 2 }] },
    ]);
    const lessonId = db.getCurriculum(bookId)[0].lessons[0].id;

    db.insertQuizAttempt(lessonId, 2, 3, [1, 0, -1], [4, 1, 7]);
    const [row] = db.getQuizAttempts(lessonId);
    expect(row.total).toBe(3);
    expect(JSON.parse(row.answers)).toEqual([1, 0, -1]);
    expect(JSON.parse(row.question_indexes as string)).toEqual([4, 1, 7]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — `insertQuizAttempt` takes 4 args / `question_indexes` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `lib/db.ts`, extend `QuizQuestion` (currently lines 67-72):

```ts
export interface QuizQuestion {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  /** Short topic label used for stratified sampling. Optional for back-compat. */
  concept?: string;
}
```

Extend `QuizAttemptRow` (currently lines 79-86) with the new column:

```ts
export interface QuizAttemptRow {
  id: string;
  lesson_id: string;
  score: number;
  total: number;
  answers: string;
  /** JSON number[] of pool indices asked, in order. NULL for legacy full-quiz attempts. */
  question_indexes: string | null;
  created_at: string;
}
```

Extend `migrate` (currently lines 181-186) to add the column idempotently:

```ts
function migrate(db: Database.Database): void {
  const cols = db.pragma("table_info(materials)") as { name: string }[];
  if (!cols.some((c) => c.name === "slides_meta")) {
    db.exec(`ALTER TABLE materials ADD COLUMN slides_meta TEXT`);
  }
  const attemptCols = db.pragma("table_info(quiz_attempts)") as { name: string }[];
  if (!attemptCols.some((c) => c.name === "question_indexes")) {
    db.exec(`ALTER TABLE quiz_attempts ADD COLUMN question_indexes TEXT`);
  }
}
```

Update `insertQuizAttempt` (currently lines 405-416):

```ts
export function insertQuizAttempt(
  lessonId: string,
  score: number,
  total: number,
  answers: number[],
  questionIndexes: number[]
): void {
  getDb()
    .prepare(
      `INSERT INTO quiz_attempts (id, lesson_id, score, total, answers, question_indexes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId(),
      lessonId,
      score,
      total,
      JSON.stringify(answers),
      JSON.stringify(questionIndexes)
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts tests/db.test.ts
git commit -m "feat(db): quiz concept field + per-attempt question indexes"
```

---

## Task 7: Split materials generation + level takeaways + add `generateQuiz`

**Files:**
- Modify: `lib/materials.ts` (whole file)
- Test: `tests/materials.test.ts` (whole file)

- [ ] **Step 1: Write the failing test**

Replace `tests/materials.test.ts` so it imports `validateLessonContent` and drops `quiz` from the fixture (quiz validation now lives in `tests/quiz.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { validateLessonContent, buildMaterialsPrompt } from "@/lib/materials";
import { starterQuestions } from "@/lib/tutor";

const valid = {
  slides: [
    { layout: "title", title: "The Strange Logic of Spin", subtitle: "Why one experiment broke classical physics", notes: "Welcome.", pages: [12] },
    { layout: "bullets", title: "What is spin?", bullets: ["A quantum property", "Binary outcomes"], notes: "Not literal rotation.", pages: [12, 13] },
    { layout: "bullets", title: "Measuring spin", bullets: ["Apparatus orientation matters"], notes: "", pages: [14] },
    { layout: "recap", title: "Remember this", bullets: ["Spin is quantized", "Measurement disturbs"], notes: "Recap." },
  ],
  takeaways: [
    { point: "Spin is quantized", detail: "Only two outcomes ever observed." },
    { point: "Measurement disturbs", detail: "Order of measurements matters." },
    { point: "Randomness is intrinsic", detail: "Not due to ignorance." },
  ],
};

describe("validateLessonContent", () => {
  it("accepts valid slides + takeaways", () => {
    const m = validateLessonContent(valid);
    expect(m.slides).toHaveLength(4);
    expect(m.slides[0].layout).toBe("title");
    expect(m.slides[1].pages).toEqual([12, 13]);
  });

  it("rejects empty slides", () => {
    expect(() => validateLessonContent({ ...valid, slides: [] })).toThrow();
  });

  it("rejects too few takeaways", () => {
    expect(() => validateLessonContent({ ...valid, takeaways: valid.takeaways.slice(0, 1) })).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => validateLessonContent("nope")).toThrow();
  });
});

describe("buildMaterialsPrompt", () => {
  it("asks for slides + takeaways only, with the learner level, and no quiz", () => {
    const p = buildMaterialsPrompt({ title: "Spin", summary: null }, "[p.1] text");
    expect(p).toContain("takeaways");
    expect(p).toContain("first-year university student"); // DEFAULT_AUDIENCE_LEVEL on takeaways
    expect(p).not.toContain('"quiz"');
    expect(p).not.toContain("answerIndex");
  });
});

describe("starterQuestions", () => {
  it("derives suggested questions from takeaways", () => {
    const qs = starterQuestions({ ...valid, quiz: [] });
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/materials.test.ts`
Expected: FAIL — `validateLessonContent`/`buildMaterialsPrompt` not exported as expected; quiz still in prompt.

- [ ] **Step 3: Write minimal implementation**

Rewrite `lib/materials.ts`. Key changes: `buildMaterialsPrompt` drops the quiz item and levels takeaways; `validateMaterials` → `validateLessonContent` returning `{ slides, takeaways }`; add `generateQuiz` (server-only, uses `buildQuizPrompt`/`validateQuiz` from `lib/quiz.ts`); `generateMaterials` runs both calls.

```ts
import type { LessonMaterials, QuizQuestion, Takeaway } from "./db";
import { DEFAULT_DECK_OPTIONS, DEFAULT_AUDIENCE_LEVEL, deckSpec, validateDeck, type Slide } from "./deck";
import { MATH_INSTRUCTION } from "./math";
import { extractJson } from "./json";
import { getLlm } from "./llm";
import { buildQuizPrompt, validateQuiz } from "./quiz";

const MAX_LESSON_CHARS = 28_000;

function fail(message: string): never {
  throw new Error(`Materials invalid: ${message}`);
}

/** Validate the slides + takeaways produced by the first generation call. */
export function validateLessonContent(data: unknown): { slides: Slide[]; takeaways: Takeaway[] } {
  if (typeof data !== "object" || data === null) fail("expected an object");
  const root = data as Record<string, unknown>;

  const slides: Slide[] = validateDeck(root.slides);

  const takeaways = root.takeaways;
  if (!Array.isArray(takeaways) || takeaways.length < 3) fail("need at least 3 takeaways");
  const validTakeaways: Takeaway[] = takeaways.map((t) => {
    const ta = t as Record<string, unknown>;
    if (typeof ta.point !== "string" || ta.point.trim() === "") fail("takeaway point missing");
    return {
      point: ta.point.trim(),
      detail: typeof ta.detail === "string" ? ta.detail : "",
    };
  });

  return { slides, takeaways: validTakeaways };
}

export function buildMaterialsPrompt(
  lesson: { title: string; summary: string | null },
  lessonText: string
): string {
  const text =
    lessonText.length > MAX_LESSON_CHARS
      ? lessonText.slice(0, MAX_LESSON_CHARS) + "\n[...truncated]"
      : lessonText;

  return `You are an expert teacher and presentation designer preparing study materials for one lesson.

LESSON: "${lesson.title}"${lesson.summary ? ` — ${lesson.summary}` : ""}

SOURCE TEXT (from the book, this lesson's pages, with [p.N] page markers):
---
${text}
---

Create study materials grounded ONLY in the source text above.

${MATH_INSTRUCTION} This applies to slides and takeaways alike.

1. slides: a presentation deck. ${deckSpec(DEFAULT_DECK_OPTIONS)}

2. takeaways: 4 to 7 key takeaways. Each has "point" (one bold-able phrase) and "detail" (1-2 sentences of explanation). Pitch every takeaway for ${DEFAULT_AUDIENCE_LEVEL}

Output ONLY this JSON, no other text:
{
  "slides": [ { "layout": "title", "title": "...", "subtitle": "...", "notes": "...", "pages": [1] } ],
  "takeaways": [ { "point": "...", "detail": "..." } ]
}`;
}

async function generateLessonContent(
  lesson: { title: string; summary: string | null },
  lessonText: string
): Promise<{ slides: Slide[]; takeaways: Takeaway[] }> {
  const prompt = buildMaterialsPrompt(lesson, lessonText);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      return validateLessonContent(extractJson(raw));
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Lesson content generation failed");
}

/** Generate the quiz question pool (its own LLM call). */
export async function generateQuiz(
  lesson: { title: string; summary: string | null },
  lessonText: string
): Promise<QuizQuestion[]> {
  const prompt = buildQuizPrompt(lesson, lessonText);
  const llm = getLlm();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = lastError
      ? `\n\nYour previous response was invalid (${lastError.message}). Output ONLY the JSON object in the exact schema requested.`
      : "";
    const raw = await llm.generate(prompt + suffix);
    try {
      const parsed = extractJson(raw) as { quiz?: unknown };
      return validateQuiz(parsed.quiz);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Quiz generation failed");
}

export async function generateMaterials(
  lesson: { title: string; summary: string | null },
  lessonText: string
): Promise<LessonMaterials> {
  const { slides, takeaways } = await generateLessonContent(lesson, lessonText);
  const quiz = await generateQuiz(lesson, lessonText);
  return { slides, takeaways, quiz };
}
```

> Note: `DEFAULT_AUDIENCE_LEVEL` is already exported from `lib/deck.ts` (added earlier). Confirm `validateDeck` and `deckSpec` are still exported there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/materials.test.ts tests/quiz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/materials.ts tests/materials.test.ts
git commit -m "feat(materials): split generation, level takeaways, quiz pool call"
```

---

## Task 8: Quiz grading route — new subset contract

**Files:**
- Modify: `app/api/lessons/[lessonId]/quiz/route.ts` (whole `POST` body)

- [ ] **Step 1: Write the implementation**

Replace the `POST` handler so it accepts `{ questions, answers }`, delegates to `gradeAttempt`, and records the indices. (No automated test — the repo has no route tests; this is covered by the manual step below and by `gradeAttempt`'s unit tests.)

```ts
import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { gradeAttempt } from "@/lib/quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string }> };

export async function POST(req: Request, { params }: Params) {
  const { lessonId } = await params;
  const materials = db.getMaterials(lessonId);
  if (!materials) {
    return NextResponse.json({ error: "Quiz not ready yet" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    questions?: unknown;
    answers?: unknown;
  };
  const questions = body.questions;
  const answers = body.answers;
  if (
    !Array.isArray(questions) ||
    !Array.isArray(answers) ||
    !questions.every((q) => typeof q === "number") ||
    !answers.every((a) => typeof a === "number")
  ) {
    return NextResponse.json(
      { error: "Expected numeric questions[] and answers[]" },
      { status: 400 }
    );
  }

  let graded;
  try {
    graded = gradeAttempt(materials.quiz, questions as number[], answers as number[]);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  db.insertQuizAttempt(
    lessonId,
    graded.score,
    graded.total,
    answers as number[],
    questions as number[]
  );

  return NextResponse.json({
    score: graded.score,
    total: graded.total,
    results: graded.results,
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "quiz/route" || echo "route OK"`
Expected: `route OK`.

- [ ] **Step 3: Commit**

```bash
git add "app/api/lessons/[lessonId]/quiz/route.ts"
git commit -m "feat(quiz-api): grade a chosen subset and record asked questions"
```

---

## Task 9: Quiz page — setup phase, sampling, Wilson "best"

**Files:**
- Modify: `components/quiz.tsx` (whole file)

- [ ] **Step 1: Write the implementation**

Rewrite `components/quiz.tsx` to add a `setup` phase before the questions. On start, sample with `selectQuestions`; iterate the sampled subset; submit `{ questions, answers }`; show Wilson-based best on the setup screen. Keep the existing per-question UI and the result review (now iterating the sampled subset).

```tsx
"use client";

import { useState } from "react";
import type { QuizAttemptRow, QuizQuestion } from "@/lib/db";
import { bestAttempt, quizCountPresets, selectQuestions } from "@/lib/quiz";
import { MathText } from "./math-text";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

interface GradeResponse {
  score: number;
  total: number;
  results: { correct: boolean; answerIndex: number; explanation: string }[];
}

export function Quiz({
  lessonId,
  quiz,
  attempts,
  onGraded,
}: {
  lessonId: string;
  quiz: QuizQuestion[];
  attempts: QuizAttemptRow[];
  onGraded: () => void;
}) {
  const presets = quizCountPresets(quiz.length);
  const [phase, setPhase] = useState<"setup" | "quiz">("setup");
  const [selected, setSelected] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<GradeResponse | null>(null);
  const [grading, setGrading] = useState(false);

  const sampled = selected.map((i) => quiz[i]);
  const question = sampled[index];

  const bestIdx = bestAttempt(attempts);
  const best = bestIdx === null ? null : attempts[bestIdx];

  function start(count: number) {
    setSelected(selectQuestions(quiz, count));
    setIndex(0);
    setAnswers([]);
    setPicked(null);
    setResult(null);
    setPhase("quiz");
  }

  async function next() {
    const finalAnswers = [...answers, picked ?? -1];
    setAnswers(finalAnswers);
    setPicked(null);
    if (index + 1 < selected.length) {
      setIndex(index + 1);
      return;
    }
    setGrading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: selected, answers: finalAnswers }),
      });
      if (res.ok) {
        setResult((await res.json()) as GradeResponse);
        onGraded();
      }
    } finally {
      setGrading(false);
    }
  }

  // ---- setup phase ----
  if (phase === "setup") {
    return (
      <div className="fade max-w-xl">
        <div className="rise rounded-2xl border border-line bg-paper-raised px-8 py-10">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">Quiz</p>
          <h2 className="mt-2 font-display text-2xl font-medium">How many questions?</h2>
          <p className="mt-2 text-sm text-ink-soft">
            {quiz.length} in the pool — we&apos;ll pick a spread across the section&apos;s topics.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {presets.options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => start(o.value)}
                className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent transition-colors cursor-pointer"
              >
                {o.label}
              </button>
            ))}
          </div>
          {best && (
            <p className="mt-6 font-mono text-xs text-ink-faint">
              best {best.score}/{best.total} ({Math.round((best.score / best.total) * 100)}%) ·{" "}
              {attempts.length} {attempts.length === 1 ? "attempt" : "attempts"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---- result phase ----
  if (result) {
    const fraction = result.score / result.total;
    return (
      <div className="fade max-w-xl">
        <div className="rise rounded-2xl border border-line bg-paper-raised px-8 py-10 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">Your score</p>
          <p className="mt-3 font-display text-6xl font-medium">
            {result.score}
            <span className="text-2xl text-ink-faint"> / {result.total}</span>
          </p>
          <p className="mt-3 text-ink-soft">
            {fraction === 1
              ? "Perfect — you own this lesson."
              : fraction >= 0.8
              ? "Strong work. One more pass and it's yours."
              : fraction >= 0.5
              ? "Good start — review the takeaways and try again."
              : "Tough one. Reread the slides, then have another go."}
          </p>
          <button
            type="button"
            onClick={() => setPhase("setup")}
            className="mt-6 rounded-full bg-accent text-accent-ink px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Take another
          </button>
        </div>

        <ol className="mt-8 space-y-5">
          {sampled.map((q, qi) => {
            const r = result.results[qi];
            const my = answers[qi];
            return (
              <li key={qi} className="rise rounded-xl border border-line-soft bg-paper-raised p-5" style={{ animationDelay: `${qi * 70}ms` }}>
                <p className="flex gap-2 font-medium leading-snug">
                  <span aria-hidden>{r.correct ? "✓" : "✕"}</span>
                  <span className={r.correct ? "text-good" : "text-bad"}>
                    <MathText>{q.question}</MathText>
                  </span>
                </p>
                <p className="mt-2 text-sm text-ink-soft">
                  {!r.correct && my >= 0 && (
                    <>
                      You said <strong><MathText>{q.choices[my]}</MathText></strong>.{" "}
                    </>
                  )}
                  Correct: <strong><MathText>{q.choices[r.answerIndex]}</MathText></strong>.{" "}
                  <MathText>{r.explanation}</MathText>
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  // ---- quiz phase ----
  return (
    <div className="fade max-w-xl">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-ink-faint">
          Question {index + 1} of {selected.length}
        </p>
      </div>

      <div className="mt-2 h-1 rounded-full bg-line-soft overflow-hidden">
        <div className="h-full bg-accent rounded-full transition-[width] duration-500" style={{ width: `${(index / selected.length) * 100}%` }} />
      </div>

      <div key={index} className="slide-in mt-8">
        <h2 className="font-display text-xl sm:text-2xl font-medium leading-snug">
          <MathText>{question.question}</MathText>
        </h2>

        <div className="mt-6 space-y-2.5" role="radiogroup" aria-label="Answers">
          {question.choices.map((choice, ci) => {
            const isPicked = picked === ci;
            const isCorrect = ci === question.answerIndex;
            const revealed = picked !== null;
            return (
              <button
                key={ci}
                type="button"
                role="radio"
                aria-checked={isPicked}
                disabled={revealed}
                onClick={() => setPicked(ci)}
                className={`w-full flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 cursor-pointer disabled:cursor-default ${
                  revealed && isCorrect
                    ? "border-good bg-good/10"
                    : revealed && isPicked
                    ? "border-bad bg-bad/10"
                    : revealed
                    ? "border-line-soft opacity-60"
                    : "border-line bg-paper-raised hover:border-accent hover:-translate-y-px"
                }`}
              >
                <span className={`mt-0.5 font-mono text-xs shrink-0 size-5 inline-flex items-center justify-center rounded border ${
                    revealed && isCorrect ? "border-good text-good" : revealed && isPicked ? "border-bad text-bad" : "border-line text-ink-faint"
                  }`}>
                  {LETTERS[ci]}
                </span>
                <span className="leading-snug"><MathText>{choice}</MathText></span>
              </button>
            );
          })}
        </div>

        {picked !== null && (
          <div className="rise mt-5 rounded-xl border border-line-soft bg-paper-raised p-4">
            <p className="text-sm font-medium">
              {picked === question.answerIndex ? (
                <span className="text-good">Correct.</span>
              ) : (
                <span className="text-bad">Not quite — it&apos;s {LETTERS[question.answerIndex]}.</span>
              )}
            </p>
            <p className="mt-1 text-sm text-ink-soft leading-relaxed">
              <MathText>{question.explanation}</MathText>
            </p>
            <button
              type="button"
              onClick={next}
              disabled={grading}
              className="mt-4 rounded-full bg-accent text-accent-ink px-5 py-2 text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {grading ? "Scoring…" : index + 1 < selected.length ? "Next question →" : "See my score"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "components/quiz" || echo "quiz component OK"`
Expected: `quiz component OK`.

- [ ] **Step 3: Commit**

```bash
git add components/quiz.tsx
git commit -m "feat(quiz-ui): choose question count, stratified sample, Wilson best"
```

---

## Task 10: Stop polling once the lesson is terminal

**Files:**
- Modify: `components/use-poll.ts` (add `setActive`); `components/lesson.tsx` (the `usePoll` call near `:51-55`)

- [ ] **Step 1: Write the implementation**

Replace the `usePoll` invocation so it only polls while the lesson is still generating:

```tsx
  const { data, error, refresh } = usePoll<LessonResponse>(
    `/api/lessons/${lessonId}`,
    2500,
    true
  );
```

becomes:

```tsx
  const poll = usePoll<LessonResponse>(`/api/lessons/${lessonId}`, 2500, true);
  const { data, error, refresh } = poll;
  // Materials are immutable once the lesson is ready/errored; the mutation paths
  // (revise, customize, quiz) call refresh() directly. Stop the interval so the
  // (now large) materials payload isn't re-fetched every 2.5s for the session.
  poll.setActive(
    !data || (data.lesson.status !== "ready" && data.lesson.status !== "error")
  );
```

This requires `usePoll` to expose runtime control of `active`. Update `components/use-poll.ts` (currently `active` is read once into a ref):

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePoll<T>(url: string, intervalMs: number, initialActive: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(initialActive);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setData((await res.json()) as T);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (activeRef.current) void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  const setActive = useCallback((next: boolean) => {
    activeRef.current = next;
  }, []);

  return { data, error, refresh, setActive };
}
```

> The interval keeps running but does nothing once inactive; `refresh()` still works for the manual mutation paths (revise/customize/quiz).

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "use-poll|lesson\.tsx" || echo "polling OK"`
Expected: `polling OK`.

- [ ] **Step 3: Commit**

```bash
git add components/use-poll.ts components/lesson.tsx
git commit -m "perf(lesson): stop polling materials once the lesson is terminal"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all files pass (existing 86 + new quiz tests; materials tests updated).

- [ ] **Step 2: Typecheck the changed app/lib files**

Run: `npx tsc --noEmit 2>&1 | grep -E "lib/quiz|lib/materials|lib/db|quiz/route|components/quiz|use-poll|lesson.tsx" || echo "changed files type-clean"`
Expected: `changed files type-clean` (a pre-existing unrelated error in `tests/materials.test.ts` should no longer appear since that file was rewritten).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Manual browser check (real generation)**

Start dev (`npx next dev -p 3210`), generate a lesson, open the Quiz tab. Confirm:
- the setup screen shows presets capped to the pool size and a `best …%` line after one attempt;
- each preset starts a quiz of that length with a spread of topics;
- finishing posts `{questions, answers}`, returns a score, and the review lists exactly the asked questions;
- "Take another" returns to the setup screen;
- in the network panel, polling of `/api/lessons/[id]` stops once the lesson is `ready`.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A && git commit -m "test: verify quiz pool + leveled materials end-to-end"
```

---

## Self-review notes (addressed)

- **Spec coverage:** level (Tasks 5, 7) · pool sizing 8–30 soft / floor 3 / cap 30 (Task 3) · concept tag (Tasks 3, 6) · stratified selection (Task 2) · presets+default (Task 2, 9) · Wilson best (Tasks 1, 9) · subset grading + indices (Tasks 4, 6, 8) · polling gate (Task 10) · back-compat (Task 6 nullable column, Task 2 legacy-concept fallback).
- **Client-safety:** `lib/quiz.ts` imports only pure modules; `generateQuiz` (uses `getLlm`) is in `lib/materials.ts` (Task 7).
- **Type consistency:** `QuizQuestion.concept?`, `gradeAttempt`/`GradedAttempt`, `insertQuizAttempt(…, questionIndexes)`, `quizCountPresets`/`selectQuestions`/`bestAttempt` signatures are identical across the tasks that define and consume them.
- **Paths confirmed:** `usePoll` lives at `components/use-poll.ts`; `tests/db.test.ts` seeds via dynamic `db` import + `insertBook`/`insertCurriculum` (Tasks 6, 10 match these).
```
