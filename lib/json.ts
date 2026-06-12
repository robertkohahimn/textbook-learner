/**
 * Pull the first parseable JSON value (object or array) out of raw LLM text.
 * Tolerates fenced code blocks and surrounding prose.
 */
export function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], raw];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const starts = ["{", "["]
      .map((ch) => candidate.indexOf(ch))
      .filter((i) => i !== -1);
    if (starts.length === 0) continue;
    const start = Math.min(...starts);
    for (let end = candidate.length; end > start; end--) {
      const slice = candidate.slice(start, end).trim();
      if (!slice.endsWith("}") && !slice.endsWith("]")) continue;
      try {
        return JSON.parse(slice) as T;
      } catch {
        // keep shrinking the window
      }
    }
  }
  throw new Error("No valid JSON found in LLM output");
}
