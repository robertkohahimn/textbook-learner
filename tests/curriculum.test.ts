import { describe, expect, it } from "vitest";
import { validateCurriculum, buildCurriculumPrompt } from "@/lib/curriculum";

const valid = {
  modules: [
    {
      title: "Foundations",
      description: "The basics",
      lessons: [
        { title: "Spin", summary: "Quantum spin", pageStart: 19, pageEnd: 36 },
        { title: "Linear Algebra", summary: "Math tools", pageStart: 37, pageEnd: 60 },
      ],
    },
  ],
};

describe("validateCurriculum", () => {
  it("accepts a valid curriculum", () => {
    const modules = validateCurriculum(valid, 214);
    expect(modules).toHaveLength(1);
    expect(modules[0].lessons[0].pageStart).toBe(19);
  });

  it("clamps page ranges into bounds and orders them", () => {
    const modules = validateCurriculum(
      {
        modules: [
          {
            title: "M",
            description: "",
            lessons: [{ title: "L", summary: "", pageStart: 300, pageEnd: -2 }],
          },
        ],
      },
      214
    );
    expect(modules[0].lessons[0].pageStart).toBe(1);
    expect(modules[0].lessons[0].pageEnd).toBe(214);
  });

  it("rejects empty modules", () => {
    expect(() => validateCurriculum({ modules: [] }, 214)).toThrow();
  });

  it("rejects a module with no lessons", () => {
    expect(() =>
      validateCurriculum(
        { modules: [{ title: "M", description: "", lessons: [] }] },
        214
      )
    ).toThrow();
  });

  it("rejects missing titles", () => {
    expect(() =>
      validateCurriculum(
        {
          modules: [
            {
              description: "",
              lessons: [{ title: "L", summary: "", pageStart: 1, pageEnd: 2 }],
            },
          ],
        },
        214
      )
    ).toThrow();
  });
});

describe("buildCurriculumPrompt", () => {
  it("includes title, outline, and page excerpts", () => {
    const prompt = buildCurriculumPrompt(
      { title: "QC for Everyone", author: "Chris B", numPages: 3 },
      ["intro text here", "chapter one begins", "more content"],
      [{ title: "1 Spin", page: 2 }]
    );
    expect(prompt).toContain("QC for Everyone");
    expect(prompt).toContain("1 Spin");
    expect(prompt).toContain("[p.2]");
    expect(prompt).toContain("chapter one begins");
  });
});
