import Anthropic from "@anthropic-ai/sdk";
import { AnthropicCompatibleProvider } from "./anthropic-compatible";

const BASE_URL = process.env.GLM_BASE_URL ?? "https://api.z.ai/api/anthropic";
// Plan-dependent: must name a model GA and entitled on the user's z.ai plan.
const MODEL = process.env.GLM_MODEL ?? "glm-4.7";

export class GlmProvider extends AnthropicCompatibleProvider {
  constructor() {
    const key = process.env.GLM_API_KEY;
    if (!key) throw new Error("GLM_API_KEY is not set. Set it to use GLM.");
    // z.ai authenticates via `Authorization: Bearer` (authToken), NOT x-api-key.
    // apiKey is nulled so the SDK does not also attach x-api-key from a process-level
    // ANTHROPIC_API_KEY — two conflicting auth headers would leak Claude's key to z.ai.
    super(new Anthropic({ baseURL: BASE_URL, apiKey: null, authToken: key }), MODEL);
  }
}
