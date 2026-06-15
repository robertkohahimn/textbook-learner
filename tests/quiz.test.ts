import { describe, expect, it } from "vitest";
import { wilsonLowerBound, bestAttempt } from "@/lib/quiz";
import { quizCountPresets, selectQuestions, validateQuiz } from "@/lib/quiz";
import { gradeAttempt } from "@/lib/quiz";
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
    expect(bestAttempt([{ score: 5, total: 5 }, { score: 18, total: 20 }])).toBe(1);
    expect(bestAttempt([{ score: 10, total: 10 }, { score: 18, total: 20 }])).toBe(0);
  });
});

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
