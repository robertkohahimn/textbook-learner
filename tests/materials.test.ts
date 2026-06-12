import { describe, expect, it } from "vitest";
import { validateMaterials } from "@/lib/materials";
import { starterQuestions } from "@/lib/tutor";

const valid = {
  slides: [
    {
      layout: "title",
      title: "The Strange Logic of Spin",
      subtitle: "Why one experiment broke classical physics",
      notes: "Welcome — today we look at spin.",
      pages: [12],
    },
    {
      layout: "bullets",
      title: "What is spin?",
      bullets: ["A quantum property", "Binary outcomes"],
      notes: "Spin is not literal rotation.",
      pages: [12, 13],
    },
    {
      layout: "bullets",
      title: "Measuring spin",
      bullets: ["Apparatus orientation matters"],
      notes: "",
      pages: [14],
    },
    {
      layout: "recap",
      title: "Remember this",
      bullets: ["Spin is quantized", "Measurement disturbs"],
      notes: "Recap before the quiz.",
    },
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
    expect(m.slides).toHaveLength(4);
    expect(m.slides[0].layout).toBe("title");
    expect(m.slides[1].pages).toEqual([12, 13]);
    expect(m.quiz[0].answerIndex).toBe(1);
  });

  it("rejects empty slides", () => {
    expect(() => validateMaterials({ ...valid, slides: [] })).toThrow();
  });

  it("rejects slides without a layout", () => {
    const bad = structuredClone(valid);
    bad.slides[1] = { title: "T", bullets: ["a"] } as (typeof bad.slides)[number];
    expect(() => validateMaterials(bad)).toThrow(/layout/);
  });

  it("rejects bullet slides without bullets", () => {
    const bad = structuredClone(valid);
    bad.slides[1] = {
      layout: "bullets",
      title: "T",
      bullets: [],
      notes: "",
    } as (typeof bad.slides)[number];
    expect(() => validateMaterials(bad)).toThrow();
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
