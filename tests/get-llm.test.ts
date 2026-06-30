import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLlm } from "@/lib/llm";
import { GlmProvider } from "@/lib/llm/glm";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { ClaudeCliProvider } from "@/lib/llm/claude-cli";

let savedAnthropic: string | undefined;
let savedGlm: string | undefined;

beforeAll(() => {
  savedAnthropic = process.env.ANTHROPIC_API_KEY;
  savedGlm = process.env.GLM_API_KEY;
});
afterAll(() => {
  if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropic;
  if (savedGlm === undefined) delete process.env.GLM_API_KEY;
  else process.env.GLM_API_KEY = savedGlm;
});

describe("getLlm provider resolution", () => {
  it("returns a GlmProvider when the injected selector picks glm", () => {
    process.env.GLM_API_KEY = "test-key";
    expect(getLlm(() => "glm")).toBeInstanceOf(GlmProvider);
  });

  it("returns an AnthropicProvider for claude when an anthropic key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(getLlm(() => "claude")).toBeInstanceOf(AnthropicProvider);
  });

  it("returns a ClaudeCliProvider for claude when no anthropic key is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getLlm(() => "claude")).toBeInstanceOf(ClaudeCliProvider);
  });
});
