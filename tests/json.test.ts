import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/json";

describe("extractJson", () => {
  it("parses plain JSON objects", () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses plain JSON arrays", () => {
    expect(extractJson<number[]>("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("parses JSON inside a fenced code block", () => {
    const raw = 'Here you go:\n```json\n{"modules": [{"title": "Spin"}]}\n```\nLet me know!';
    expect(extractJson(raw)).toEqual({ modules: [{ title: "Spin" }] });
  });

  it("parses JSON inside an unlabeled fence", () => {
    const raw = '```\n{"a": true}\n```';
    expect(extractJson(raw)).toEqual({ a: true });
  });

  it("parses JSON wrapped in prose", () => {
    const raw = 'Sure! The curriculum is {"a": {"b": [1, 2]}} — hope that helps.';
    expect(extractJson(raw)).toEqual({ a: { b: [1, 2] } });
  });

  it("handles strings containing braces", () => {
    const raw = '{"q": "What is {x}?", "n": 1}';
    expect(extractJson(raw)).toEqual({ q: "What is {x}?", n: 1 });
  });

  it("throws on output with no JSON", () => {
    expect(() => extractJson("I cannot help with that.")).toThrow(/No valid JSON/);
  });

  it("throws on truncated JSON", () => {
    expect(() => extractJson('{"a": [1, 2')).toThrow(/No valid JSON/);
  });
});
