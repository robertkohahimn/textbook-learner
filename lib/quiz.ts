import type { QuizQuestion } from "./db";

/** Wilson score interval lower bound of accuracy (z=1.96 ≈ 95%). total=0 -> 0. */
export function wilsonLowerBound(correct: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const phat = correct / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

/** Index of the attempt with the highest Wilson lower bound; null if none. */
export function bestAttempt(
  attempts: { score: number; total: number }[]
): number | null {
  let best: number | null = null;
  let bestLb = -1;
  attempts.forEach((a, i) => {
    const lb = wilsonLowerBound(a.score, a.total);
    if (lb > bestLb) {
      bestLb = lb;
      best = i;
    }
  });
  return best;
}

/** Preset choices for the "how many questions?" picker, given the pool size. */
export function quizCountPresets(poolSize: number): {
  options: { label: string; value: number }[];
  defaultValue: number;
} {
  const options = [5, 10, 20]
    .filter((p) => p < poolSize)
    .map((p) => ({ label: String(p), value: p }));
  options.push({ label: `All (${poolSize})`, value: poolSize });
  return { options, defaultValue: poolSize >= 10 ? 10 : poolSize };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Stratified random sample of `count` questions from `pool`. Groups by concept
 * (blank/missing concept => its own singleton stratum) and round-robins across
 * groups, so any count is spread across as many concepts as possible. Returns
 * original-pool indices in randomized presentation order.
 */
export function selectQuestions(
  pool: QuizQuestion[],
  count: number,
  rng: () => number = Math.random
): number[] {
  if (pool.length === 0) return [];
  const n = Math.max(1, Math.min(Math.floor(count) || 1, pool.length));

  const groups = new Map<string, number[]>();
  pool.forEach((q, i) => {
    const key = q.concept && q.concept.trim() ? q.concept.trim() : `__solo_${i}`;
    const existing = groups.get(key);
    if (existing) existing.push(i);
    else groups.set(key, [i]);
  });

  const buckets = shuffle(
    [...groups.values()].map((g) => shuffle(g, rng)),
    rng
  );

  const picked: number[] = [];
  let progress = true;
  while (picked.length < n && progress) {
    progress = false;
    for (const bucket of buckets) {
      if (bucket.length === 0) continue;
      picked.push(bucket.pop() as number);
      progress = true;
      if (picked.length >= n) break;
    }
  }
  return shuffle(picked, rng);
}
