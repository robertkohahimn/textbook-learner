import { describe, expect, it } from "vitest";
import { buildTutorPrompt, sanitizeSlideContext } from "@/lib/tutor";

const lesson = { title: "Photosynthesis", summary: null };

describe("buildTutorPrompt currentSlide", () => {
  it("omits the slide line when no currentSlide is given", () => {
    const { system } = buildTutorPrompt(lesson, undefined, "text", [], "q?");
    expect(system).not.toMatch(/currently viewing slide/i);
  });

  it("adds a 1-based slide line with the title when given", () => {
    const { system } = buildTutorPrompt(lesson, undefined, "text", [], "q?", {
      index: 2,
      title: "Light reactions",
    });
    expect(system).toContain('currently viewing slide 3: "Light reactions"');
  });

  it("adds the slide number without a quote when the title is empty", () => {
    const { system } = buildTutorPrompt(lesson, undefined, "text", [], "q?", {
      index: 0,
      title: "",
    });
    expect(system).toMatch(/currently viewing slide 1\./);
  });
});

describe("sanitizeSlideContext", () => {
  it("rejects non-objects and bad indices", () => {
    expect(sanitizeSlideContext(undefined)).toBeUndefined();
    expect(sanitizeSlideContext({ index: -1, title: "x" })).toBeUndefined();
    expect(sanitizeSlideContext({ index: 1.5, title: "x" })).toBeUndefined();
    expect(sanitizeSlideContext({ title: "x" })).toBeUndefined();
  });

  it("accepts a valid context and coerces a missing title to ''", () => {
    expect(sanitizeSlideContext({ index: 4 })).toEqual({ index: 4, title: "" });
  });

  it("truncates the title to 200 chars", () => {
    const long = "z".repeat(500);
    const out = sanitizeSlideContext({ index: 0, title: long });
    expect(out?.title.length).toBe(200);
  });
});
