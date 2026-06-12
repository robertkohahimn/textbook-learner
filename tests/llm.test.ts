import { describe, it, expect } from "vitest";
import { ClaudeCliProvider, parseStreamLine } from "@/lib/llm/claude-cli";

describe.skipIf(!process.env.LIVE)("ClaudeCliProvider (live)", () => {
  it("generates a one-shot completion", async () => {
    const out = await new ClaudeCliProvider().generate(
      "Reply with exactly the word OK and nothing else."
    );
    expect(out.trim()).toBe("OK");
  });

  it("streams a completion in chunks", async () => {
    const chunks: string[] = [];
    for await (const chunk of new ClaudeCliProvider().stream(
      "Count from 1 to 5 as plain digits separated by spaces. No other text."
    )) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toContain("1 2 3 4 5");
  });
});

describe("parseStreamLine", () => {
  it("extracts text from partial message deltas", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
    });
    expect(parseStreamLine(line)).toEqual({ text: "Hello" });
  });

  it("extracts the final result", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Full answer.",
    });
    expect(parseStreamLine(line)).toEqual({ result: "Full answer.", isError: false });
  });

  it("flags error results", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "boom",
    });
    expect(parseStreamLine(line)).toEqual({ result: "boom", isError: true });
  });

  it("ignores system/init lines", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "x" });
    expect(parseStreamLine(line)).toEqual({});
  });

  it("ignores non-text deltas (thinking, tool use)", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{" },
      },
    });
    expect(parseStreamLine(line)).toEqual({});
  });

  it("ignores unparseable lines", () => {
    expect(parseStreamLine("not json at all")).toEqual({});
    expect(parseStreamLine("")).toEqual({});
  });
});
