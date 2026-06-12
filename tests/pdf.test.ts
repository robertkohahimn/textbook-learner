import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { extractBook } from "@/lib/pdf";

const REFERENCE_PDF =
  "/Users/Maestro/Vault/Thinking/03_Study/Quantum/Quantum Computing For Everyone/Quantum computing for everyone by Bernhardt, Chris (z-lib.org).pdf";

describe.skipIf(!existsSync(REFERENCE_PDF))("extractBook (reference book)", () => {
  it("extracts pages, metadata, and a page-resolved outline", async () => {
    const buf = new Uint8Array(readFileSync(REFERENCE_PDF));
    const book = await extractBook(buf);

    expect(book.numPages).toBe(214);
    expect(book.pages).toHaveLength(214);
    expect(book.title).toBe("Quantum Computing for Everyone");
    expect(book.author).toBe("Chris Bernhardt");

    expect(book.outline.length).toBeGreaterThanOrEqual(10);
    const resolved = book.outline.filter((o) => o.page !== null);
    expect(resolved.length).toBeGreaterThanOrEqual(10);
    const pages = resolved.map((o) => o.page!) ;
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  }, 60_000);

  it("rejects PDFs with no extractable text", async () => {
    // Minimal valid one-page PDF with no text content.
    const empty = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
0 4
0000000000 65535 f
trailer << /Size 4 /Root 1 0 R >>
startxref
0
%%EOF`;
    await expect(extractBook(new TextEncoder().encode(empty))).rejects.toThrow(
      /NO_TEXT/
    );
  });
});
