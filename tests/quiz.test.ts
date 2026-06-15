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
    expect(bestAttempt([{ score: 5, total: 5 }, { score: 18, total: 20 }])).toBe(1);
    expect(bestAttempt([{ score: 10, total: 10 }, { score: 18, total: 20 }])).toBe(0);
  });
});
