import { describe, expect, it } from "vitest";
import { validateLessonContent, buildMaterialsPrompt } from "@/lib/materials";
import { starterQuestions } from "@/lib/tutor";
import type { LessonMaterials } from "@/lib/db";

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
    const qs = starterQuestions({ ...valid, quiz: [] } as LessonMaterials);
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.length).toBeLessThanOrEqual(3);
  });
});
