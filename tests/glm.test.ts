import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("GlmProvider", () => {
  let savedKey: string | undefined;
  beforeAll(() => {
    savedKey = process.env.GLM_API_KEY;
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = savedKey;
  });

  it("throws a clear error when GLM_API_KEY is missing", async () => {
    delete process.env.GLM_API_KEY;
    const { GlmProvider } = await import("@/lib/llm/glm");
    expect(() => new GlmProvider()).toThrow(/GLM_API_KEY/);
  });
});

// Live check — only runs when LIVE=1 and a real GLM key is present.
describe.skipIf(!process.env.LIVE || !process.env.GLM_API_KEY)(
  "GlmProvider (live)",
  () => {
    it("generates a one-shot completion via z.ai", async () => {
      const { GlmProvider } = await import("@/lib/llm/glm");
      const out = await new GlmProvider().generate(
        "Reply with exactly the word OK and nothing else."
      );
      expect(out.toUpperCase()).toContain("OK");
    });
  }
);
