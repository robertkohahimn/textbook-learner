import { describe, expect, it } from "vitest";
import {
  buildFieldPieces,
  validateSlideAnnotation,
  type Highlight,
} from "@/lib/annotations";

function range(start: number, end: number, id = "h"): Pick<
  Highlight,
  "start" | "end" | "id"
> {
  return { start, end, id };
}

describe("buildFieldPieces", () => {
  it("returns one unmarked text piece when there are no ranges", () => {
    expect(buildFieldPieces("hello world", [])).toEqual([
      { kind: "text", value: "hello world", marked: false, ids: [] },
    ]);
  });

  it("marks a sub-range of plain text", () => {
    expect(buildFieldPieces("hello world", [range(0, 5, "a")])).toEqual([
      { kind: "text", value: "hello", marked: true, ids: ["a"] },
      { kind: "text", value: " world", marked: false, ids: [] },
    ]);
  });

  it("marks a range in the middle", () => {
    expect(buildFieldPieces("abcdef", [range(2, 4, "m")])).toEqual([
      { kind: "text", value: "ab", marked: false, ids: [] },
      { kind: "text", value: "cd", marked: true, ids: ["m"] },
      { kind: "text", value: "ef", marked: false, ids: [] },
    ]);
  });

  it("treats a math segment as atomic — marked if any overlap", () => {
    // logical string: "E = " (0..4) + "mc^2" (4..8)
    const pieces = buildFieldPieces("E = $mc^2$", [range(5, 6, "x")]);
    expect(pieces).toEqual([
      { kind: "text", value: "E = ", marked: false, ids: [] },
      { kind: "math", value: "mc^2", marked: true, ids: ["x"] },
    ]);
  });

  it("does not mark a math segment when the range stops at its edge", () => {
    const pieces = buildFieldPieces("E = $mc^2$", [range(0, 4, "x")]);
    expect(pieces).toEqual([
      { kind: "text", value: "E = ", marked: true, ids: ["x"] },
      { kind: "math", value: "mc^2", marked: false, ids: [] },
    ]);
  });

  it("handles a highlight spanning text and a math unit", () => {
    // "a " (0..2) + "x" (2..3) + " b" (3..5)
    const pieces = buildFieldPieces("a $x$ b", [range(1, 4, "h")]);
    expect(pieces).toEqual([
      { kind: "text", value: "a", marked: false, ids: [] },
      { kind: "text", value: " ", marked: true, ids: ["h"] },
      { kind: "math", value: "x", marked: true, ids: ["h"] },
      { kind: "text", value: " ", marked: true, ids: ["h"] },
      { kind: "text", value: "b", marked: false, ids: [] },
    ]);
  });

  it("merges ids when two ranges overlap the same characters", () => {
    const pieces = buildFieldPieces("abcd", [range(0, 3, "a"), range(2, 4, "b")]);
    expect(pieces).toEqual([
      { kind: "text", value: "ab", marked: true, ids: ["a"] },
      { kind: "text", value: "c", marked: true, ids: ["a", "b"] },
      { kind: "text", value: "d", marked: true, ids: ["b"] },
    ]);
  });
});

describe("validateSlideAnnotation", () => {
  it("defaults a missing/garbage value to an empty annotation", () => {
    expect(validateSlideAnnotation(null)).toEqual({ note: "", highlights: [] });
    expect(validateSlideAnnotation({})).toEqual({ note: "", highlights: [] });
  });

  it("keeps a well-formed annotation", () => {
    const a = {
      note: "study this",
      highlights: [
        { id: "1", field: "bullet:0", start: 0, end: 4, quote: "abcd", note: "key" },
      ],
    };
    expect(validateSlideAnnotation(a)).toEqual(a);
  });

  it("drops highlights with an invalid range or missing field", () => {
    const a = {
      note: 5,
      highlights: [
        { id: "1", field: "bullet:0", start: 4, end: 2, quote: "x" }, // start>=end
        { id: "2", start: 0, end: 1, quote: "y" }, // no field
        { id: "3", field: "quote", start: 0, end: 2, quote: "ok" }, // valid
      ],
    };
    expect(validateSlideAnnotation(a)).toEqual({
      note: "",
      highlights: [{ id: "3", field: "quote", start: 0, end: 2, quote: "ok" }],
    });
  });

  it("coerces a numeric per-highlight note away and trims the slide note", () => {
    const a = {
      note: "  spaced  ",
      highlights: [{ id: "1", field: "quote", start: 0, end: 1, quote: "a", note: 9 }],
    };
    const v = validateSlideAnnotation(a);
    expect(v.note).toBe("spaced");
    expect(v.highlights[0].note).toBeUndefined();
  });
});
