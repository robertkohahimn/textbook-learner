import type { LlmProvider } from "./types";
import { ClaudeCliProvider } from "./claude-cli";
import { AnthropicProvider } from "./anthropic";
import { GlmProvider } from "./glm";
import { resolveActiveProviderId, type ProviderId } from "./resolve";
import { getActiveProvider } from "../db";

export type { LlmProvider, LlmOptions } from "./types";

const cache = new Map<ProviderId, LlmProvider>();

function construct(id: ProviderId): LlmProvider {
  switch (id) {
    case "glm":
      return new GlmProvider();
    case "claude-api":
      return new AnthropicProvider();
    case "claude-cli":
      return new ClaudeCliProvider();
  }
}

/**
 * The active LLM provider, resolved per call from the persisted setting + env so a
 * Settings change takes effect without a restart. Instances are memoized per resolved id.
 *
 * The selector is injected (default = the DB-backed getActiveProvider) so this stays unit-
 * testable with a stub and no database. getDb() is lazy, so merely importing this module
 * does not open a database — only calling the default selector does.
 */
export function getLlm(
  getSelected: () => "claude" | "glm" = getActiveProvider
): LlmProvider {
  const id = resolveActiveProviderId(getSelected(), process.env);
  let provider = cache.get(id);
  if (!provider) {
    provider = construct(id);
    cache.set(id, provider);
  }
  return provider;
}
