import { describe, expect, it } from "vitest";
import { validateMaterials } from "@/lib/materials";
import { starterQuestions } from "@/lib/tutor";

const valid = {
  slides: [
    { title: "What is spin?", bullets: ["A quantum property", "Binary outcomes"] },
    { title: "Measuring spin", bullets: ["Apparatus orientation matters"] },
  ],
  takeaways: [
    { point: "Spin is quantized", detail: "Only two outcomes ever observed." },
    { point: "Measurement disturbs", detail: "Order of measurements matters." },
    { point: "Randomness is intrinsic", detail: "Not due to ignorance." },
  ],
  quiz: [
    {
      question: "How many outcomes does a spin measurement have?",
      choices: ["One", "Two", "Three", "Infinitely many"],
      answerIndex: 1,
      explanation: "Spin measurements are binary.",
    },
    {
      question: "q2",
      choices: ["a", "b", "c", "d"],
      answerIndex: 0,
      explanation: "e2",
    },
    {
      question: "q3",
      choices: ["a", "b", "c", "d"],
      answerIndex: 3,
      explanation: "e3",
    },
  ],
};

describe("validateMaterials", () => {
  it("accepts valid materials", () => {
    const m = validateMaterials(valid);
    expect(m.slides).toHaveLength(2);
    expect(m.quiz[0].answerIndex).toBe(1);
  });

  it("rejects empty slides", () => {
    expect(() => validateMaterials({ ...valid, slides: [] })).toThrow();
  });

  it("rejects slides without bullets", () => {
    expect(() =>
      validateMaterials({ ...valid, slides: [{ title: "T", bullets: [] }] })
    ).toThrow();
  });

  it("rejects too few takeaways", () => {
    expect(() =>
      validateMaterials({ ...valid, takeaways: valid.takeaways.slice(0, 1) })
    ).toThrow();
  });

  it("rejects too few quiz questions", () => {
    expect(() =>
      validateMaterials({ ...valid, quiz: valid.quiz.slice(0, 1) })
    ).toThrow();
  });

  it("rejects out-of-range answerIndex", () => {
    const bad = structuredClone(valid);
    bad.quiz[0].answerIndex = 4;
    expect(() => validateMaterials(bad)).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => validateMaterials("nope")).toThrow();
    expect(() => validateMaterials(null)).toThrow();
  });
});

describe("starterQuestions", () => {
  it("derives suggested questions from takeaways", () => {
    const qs = starterQuestions(valid);
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.length).toBeLessThanOrEqual(3);
    for (const q of qs) expect(typeof q).toBe("string");
  });
});
