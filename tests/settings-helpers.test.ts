import { describe, expect, it } from "vitest";
import { providerInfos, isProviderAvailable } from "@/lib/settings";

describe("providerInfos", () => {
  it("always marks claude available; glm depends on GLM_API_KEY", () => {
    const withKey = providerInfos({ GLM_API_KEY: "z" });
    expect(withKey.find((p) => p.id === "claude")?.available).toBe(true);
    expect(withKey.find((p) => p.id === "glm")?.available).toBe(true);

    const withoutKey = providerInfos({});
    expect(withoutKey.find((p) => p.id === "glm")?.available).toBe(false);
  });
});

describe("isProviderAvailable", () => {
  it("is true for claude, and for glm only with a key", () => {
    expect(isProviderAvailable("claude", {})).toBe(true);
    expect(isProviderAvailable("glm", {})).toBe(false);
    expect(isProviderAvailable("glm", { GLM_API_KEY: "z" })).toBe(true);
    expect(isProviderAvailable("nonsense", { GLM_API_KEY: "z" })).toBe(false);
  });
});
