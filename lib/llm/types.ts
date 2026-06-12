export interface LlmOptions {
  system?: string;
}

export interface LlmProvider {
  /** One-shot completion. Returns the full response text. */
  generate(prompt: string, opts?: LlmOptions): Promise<string>;
  /** Streaming completion. Yields response text chunks. */
  stream(prompt: string, opts?: LlmOptions): AsyncIterable<string>;
}
