import type { LlmProvider } from "./types";
import { ClaudeCliProvider } from "./claude-cli";
import { AnthropicProvider } from "./anthropic";

export type { LlmProvider, LlmOptions, } from "./types";

let provider: LlmProvider | undefined;

/** Anthropic API when a key is configured, otherwise the local claude CLI. */
export function getLlm(): LlmProvider {
  provider ??= process.env.ANTHROPIC_API_KEY
    ? new AnthropicProvider()
    : new ClaudeCliProvider();
  return provider;
}
