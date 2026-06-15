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
