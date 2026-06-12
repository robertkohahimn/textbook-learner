import Anthropic from "@anthropic-ai/sdk";
import type { LlmOptions, LlmProvider } from "./types";

const MODEL = process.env.LLM_MODEL?.startsWith("claude-")
  ? process.env.LLM_MODEL
  : "claude-sonnet-4-6";
const MAX_TOKENS = 8192;

export class AnthropicProvider implements LlmProvider {
  private client = new Anthropic();

  async generate(prompt: string, opts?: LlmOptions): Promise<string> {
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: opts?.system,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  async *stream(prompt: string, opts?: LlmOptions): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: opts?.system,
      messages: [{ role: "user", content: prompt }],
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }
}
