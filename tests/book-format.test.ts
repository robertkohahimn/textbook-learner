import { describe, expect, it } from "vitest";
import { formatFromFilename, titleFromFilename } from "@/lib/book-format";

describe("formatFromFilename", () => {
  it("detects pdf and epub case-insensitively", () => {
    expect(formatFromFilename("a.pdf")).toBe("pdf");
    expect(formatFromFilename("a.PDF")).toBe("pdf");
    expect(formatFromFilename("a.epub")).toBe("epub");
    expect(formatFromFilename("My Book.EPUB")).toBe("epub");
  });
  it("returns null for unsupported types", () => {
    expect(formatFromFilename("a.txt")).toBeNull();
    expect(formatFromFilename("epub")).toBeNull();
    expect(formatFromFilename("a.pdf.zip")).toBeNull();
  });
});

describe("titleFromFilename", () => {
  it("strips either extension and tidies separators", () => {
    expect(titleFromFilename("quantum_computing-intro.epub")).toBe("quantum computing intro");
    expect(titleFromFilename("Some Book.pdf")).toBe("Some Book");
  });
});
