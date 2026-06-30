import { describe, expect, it } from "vitest";
import { resolveActiveProviderId } from "@/lib/llm/resolve";

describe("resolveActiveProviderId", () => {
  it("selects glm whenever glm is chosen, regardless of the anthropic key", () => {
    expect(resolveActiveProviderId("glm", {})).toBe("glm");
    expect(resolveActiveProviderId("glm", { ANTHROPIC_API_KEY: "sk" })).toBe("glm");
  });

  it("selects the anthropic api when claude is chosen and a key is present", () => {
    expect(resolveActiveProviderId("claude", { ANTHROPIC_API_KEY: "sk" })).toBe(
      "claude-api"
    );
  });

  it("falls back to the claude cli when claude is chosen and no key is present", () => {
    expect(resolveActiveProviderId("claude", {})).toBe("claude-cli");
    expect(resolveActiveProviderId("claude", { ANTHROPIC_API_KEY: "" })).toBe(
      "claude-cli"
    );
  });
});
