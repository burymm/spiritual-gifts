import type {
  GiftInterpretation,
  GiftProfile,
  GiftScore,
  Quality,
  WeightVector,
} from '../models';
import { STRONG_THRESHOLD, TOP_N, WEAK_THRESHOLD } from '../config';

/**
 * Euclidean distance between the normalized user vector and a gift profile.
 *
 * `weights` is aligned with `qualities`; a missing quality counts as 0 in the
 * gift profile (profiles only list the qualities that matter for that gift).
 */
export function euclideanDistance(
  weights: WeightVector,
  pool: number,
  qualities: readonly Quality[],
  gift: GiftProfile,
): number {
  let squared = 0;
  for (let i = 0; i < qualities.length; i++) {
    const userShare = weights[i] / pool;
    const ideal = gift.weights[qualities[i].id] ?? 0;
    const diff = userShare - ideal;
    squared += diff * diff;
  }
  return Math.sqrt(squared);
}

/**
 * Score every gift: `(1 − distance) × 100`, computed literally so it can be
 * negative (docs §2.4). `display` clamps negatives to 0 for the UI.
 *
 * Sorted by raw score descending; ties fall back to the smaller gift id.
 */
export function scoreGifts(
  weights: WeightVector,
  pool: number,
  qualities: readonly Quality[],
  gifts: readonly GiftProfile[],
): GiftScore[] {
  return gifts
    .map((gift) => {
      const distance = euclideanDistance(weights, pool, qualities, gift);
      const score = (1 - distance) * 100;
      return {
        giftId: gift.id,
        giftName: gift.name,
        distance,
        score,
        display: Math.max(0, score),
      };
    })
    .sort((a, b) => b.score - a.score || a.giftId - b.giftId);
}

export interface InterpretOptions {
  readonly strong?: number;
  readonly weak?: number;
  readonly top?: number;
}

/**
 * Rank, strength label and top-3 flag.
 *
 * Thresholds use the *displayed* percentage, so a negative raw score lands in
 * the weak zone instead of a separate negative bucket.
 */
export function interpret(
  scores: readonly GiftScore[],
  options: InterpretOptions = {},
): GiftInterpretation[] {
  const strong = options.strong ?? STRONG_THRESHOLD;
  const weak = options.weak ?? WEAK_THRESHOLD;
  const top = options.top ?? TOP_N;

  return scores.map((score, idx) => ({
    score,
    rank: idx + 1,
    strength:
      score.display >= strong ? 'strong' : score.display < weak ? 'weak' : 'possible',
    top: idx < top,
  }));
}
