import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let db: typeof import("@/lib/db");

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "tbl-settings-"));
  db = await import("@/lib/db");
});

describe("settings store", () => {
  it("returns undefined for an unset key", () => {
    expect(db.getSetting("nope")).toBeUndefined();
  });

  it("round-trips a value and overwrites on conflict", () => {
    db.setSetting("active_provider", "glm");
    expect(db.getSetting("active_provider")).toBe("glm");
    db.setSetting("active_provider", "claude");
    expect(db.getSetting("active_provider")).toBe("claude");
  });

  it("defaults active provider to claude when unset or unrecognized", () => {
    db.setSetting("active_provider", "weird-value");
    expect(db.getActiveProvider()).toBe("claude");
    db.setActiveProvider("glm");
    expect(db.getActiveProvider()).toBe("glm");
  });
});
