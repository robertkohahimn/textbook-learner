import type { QuizQuestion } from "./db";
import { DEFAULT_AUDIENCE_LEVEL } from "./deck";
import { MATH_INSTRUCTION } from "./math";

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
