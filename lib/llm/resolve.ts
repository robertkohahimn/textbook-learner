export type ProviderId = "claude-api" | "claude-cli" | "glm";

/**
 * Map the user-facing selection + environment to a concrete provider id. Pure: no I/O,
 * so it is fully unit-tested. "claude" preserves the original env-based behavior
 * (Anthropic API when a key is set, otherwise the local claude CLI).
 */
export function resolveActiveProviderId(
  selected: "claude" | "glm",
  env: { ANTHROPIC_API_KEY?: string }
): ProviderId {
  if (selected === "glm") return "glm";
  return env.ANTHROPIC_API_KEY ? "claude-api" : "claude-cli";
}
