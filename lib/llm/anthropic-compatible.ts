import type Anthropic from "@anthropic-ai/sdk";
import type { LlmOptions, LlmProvider } from "./types";

/** Shared implementation for any Anthropic Messages API-compatible endpoint. */
export class AnthropicCompatibleProvider implements LlmProvider {
  constructor(
    protected readonly client: Anthropic,
    protected readonly model: string,
    protected readonly maxTokens = 8192
  ) {}

  async generate(prompt: string, opts?: LlmOptions): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
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
      model: this.model,
      max_tokens: this.maxTokens,
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
