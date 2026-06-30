import { describe, expect, it } from "vitest";
import { paginate } from "@/lib/epub-paginate";

const para = (n: number, fill = "x") => fill.repeat(n);

describe("paginate", () => {
  it("forces a page break at each document boundary", () => {
    const { pages, docStartPage } = paginate(["short one", "short two"], { pageChars: 1800 });
    expect(pages).toEqual(["short one", "short two"]);
    expect(docStartPage).toEqual([0, 1]);
  });

  it("packs paragraphs up to pageChars, breaking at paragraph boundaries", () => {
    // Three 700-char paragraphs: 700+700 (=1402 incl. separator) fits page 1; the
    // third spills to page 2. Two paragraphs of 1000 would NOT co-locate (2002 > 1800).
    const doc = [para(700, "a"), para(700, "b"), para(700, "c")].join("\n\n");
    const { pages, docStartPage } = paginate([doc], { pageChars: 1800 });
    expect(docStartPage).toEqual([0]);
    expect(pages.length).toBe(2); // [1402, 700]
    expect(pages.every((p) => p.length <= 1800)).toBe(true);
  });

  it("hard-splits a single paragraph longer than pageChars", () => {
    const { pages } = paginate([para(4000, "z")], { pageChars: 1800 });
    expect(pages.length).toBe(3); // 1800 + 1800 + 400
    expect(pages[0].length).toBe(1800);
  });

  it("skips empty/whitespace documents but still records a start page", () => {
    const { pages, docStartPage } = paginate(["real text", "   \n  ", "more text"], { pageChars: 1800 });
    expect(pages).toEqual(["real text", "more text"]);
    // empty doc 1 points at the page that follows it (doc 2's page).
    expect(docStartPage).toEqual([0, 1, 1]);
  });

  it("throws when total text exceeds the backstop", () => {
    expect(() => paginate([para(50, "q")], { pageChars: 1800, maxTotalChars: 10 })).toThrow(
      /EPUB_TOO_LARGE/
    );
  });
});
