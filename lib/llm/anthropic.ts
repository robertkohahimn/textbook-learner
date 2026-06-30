import Anthropic from "@anthropic-ai/sdk";
import { AnthropicCompatibleProvider } from "./anthropic-compatible";

const MODEL = process.env.LLM_MODEL?.startsWith("claude-")
  ? process.env.LLM_MODEL
  : "claude-sonnet-4-6";

export class AnthropicProvider extends AnthropicCompatibleProvider {
  constructor() {
    super(new Anthropic(), MODEL);
  }
}
