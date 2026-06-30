import { describe, expect, it } from "vitest";
import { decodeEntities, xhtmlToText } from "@/lib/epub-text";

describe("decodeEntities", () => {
  it("decodes numeric and named entities", () => {
    expect(decodeEntities("a&#65;b")).toBe("aAb");
    expect(decodeEntities("x&#x41;y")).toBe("xAy");
    expect(decodeEntities("Chapter&nbsp;1")).toBe("Chapter 1");
    expect(decodeEntities("&ldquo;hi&rdquo; &amp; &mdash;")).toBe("“hi” & —");
  });
  it("leaves unknown named entities intact", () => {
    expect(decodeEntities("a&unknownentity;b")).toBe("a&unknownentity;b");
  });
});

describe("xhtmlToText", () => {
  it("inserts a boundary between block elements (no word fusion)", () => {
    expect(xhtmlToText("<p>alpha</p><p>beta</p>")).toBe("alpha\nbeta");
  });
  it("does not insert boundaries inside inline elements", () => {
    expect(xhtmlToText("<p>a<em>b</em><span>c</span>d</p>")).toBe("abcd");
  });
  it("drops script and style content", () => {
    expect(xhtmlToText("<p>keep</p><style>.x{color:red}</style><script>var x=1;</script>"))
      .toBe("keep");
  });
  it("decodes entities and collapses whitespace", () => {
    expect(xhtmlToText("<p>a&nbsp;&nbsp;b   c</p>")).toBe("a b c");
  });
  it("treats <br/> as a line boundary", () => {
    expect(xhtmlToText("<p>a<br/>b</p>")).toBe("a\nb");
  });
});
