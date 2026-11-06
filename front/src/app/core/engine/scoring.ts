import type {
  GiftInterpretation,
  GiftProfile,
  GiftScore,
  Quality,
  QualityIndex,
  WeightVector,
} from '../models';
import { STRONG_THRESHOLD, TOP_N, WEAK_THRESHOLD } from '../config';
import { giftExpression, pseudoIndexes } from './quality-indexes';
import { maxWeightFor } from './weights';

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
 * Score every gift.
 *
 * Primary result: `expression` — how strongly the gift's qualities are
 * expressed (weighted mean of the 1–5 indexes, shown as a percentage).
 * Secondary diagnostic: `match` — the old Euclidean profile comparison
 * `(1 − distance) × 100`; it can be negative and is not used for ranking.
 *
 * `indexes` comes from a completed survey. Without them (manual calibration,
 * 360° aggregate, uniform start) pseudo-indexes are derived from the weights so
 * the screen still has a comparable 0–100 scale.
 *
 * `signExpressions` holds direct percentages for the sign gifts (19–22) from
 * questions 161–200. When present they replace the quality-based expression:
 * the qualities are only indirect proxies there, while the block asks about the
 * manifestation directly.
 *
 * Sorted by expression descending; ties fall back to the smaller gift id, so a
 * neutral profile ranks all gifts equally instead of favouring sparse profiles.
 */
export function scoreGifts(
  weights: WeightVector,
  pool: number,
  qualities: readonly Quality[],
  gifts: readonly GiftProfile[],
  indexes: readonly QualityIndex[] | null = null,
  signExpressions: ReadonlyMap<number, number> | null = null,
): GiftScore[] {
  const effectiveIndexes =
    indexes ?? pseudoIndexes(weights, maxWeightFor(qualities.length));

  return gifts
    .map((gift) => {
      const distance = euclideanDistance(weights, pool, qualities, gift);
      const match = (1 - distance) * 100;
      const direct = signExpressions?.get(gift.id);
      const expression =
        direct !== undefined ? direct : giftExpression(gift, effectiveIndexes);
      return {
        giftId: gift.id,
        giftName: gift.name,
        distance,
        match,
        expression,
        display: Math.max(0, Math.min(100, expression)),
      };
    })
    // Sort by the displayed value with a small epsilon: equal expression must
    // stay a neutral tie instead of being ordered by rounding noise.
    .sort((a, b) => {
      const diff = b.display - a.display;
      return Math.abs(diff) > 1e-6 ? diff : a.giftId - b.giftId;
    });
}

export interface InterpretOptions {
  readonly strong?: number;
  readonly weak?: number;
  readonly top?: number;
}

/**
 * Rank, strength label and top-3 flag.
 *
 * Thresholds use the displayed expression percentage (4 из 5 = 80%), not the
 * secondary profile match.
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
