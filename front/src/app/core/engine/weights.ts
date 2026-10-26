import type { WeightVector } from '../models';
import { BASE_WEIGHT } from '../config';

/** Total weight pool for `count` qualities: 20 × N (480 for 24 qualities). */
export function poolFor(count: number): number {
  return BASE_WEIGHT * count;
}

/**
 * Maximum weight of one quality.
 *
 * Docs §2.2 / «Контекст проекта»: the agreed limit is N × 19 (456 for 24).
 * The purely arithmetic bound is 457 (pool minus the minimum 1 for each of the
 * other 23 qualities), but the agreed rule is stricter.
 */
export function maxWeightFor(count: number): number {
  return poolFor(count) - count;
}

/** Equal split: 20 units per quality. */
export function uniformWeights(count: number): number[] {
  return Array.from({ length: count }, () => BASE_WEIGHT);
}

/**
 * Largest-remainder rounding (docs §2.2, step 3).
 *
 * Floor every value, then hand out the leftover units one by one to the
 * qualities with the largest fractional parts. Ties go to the smaller index
 * (which is the smaller quality id, because qualities are sorted by id).
 *
 * The result always sums to exactly `total`.
 */
export function largestRemainder(
  raw: readonly number[],
  total: number,
): number[] {
  if (raw.length === 0) return [];

  const floors = raw.map((v) => Math.floor(v));
  const out = floors.slice();
  let left = total - floors.reduce((a, b) => a + b, 0);

  const byFraction = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  // Floating point may overshoot by a unit or two; take it back from the
  // smallest fractional parts so the sum stays exact.
  while (left < 0) {
    let taken = false;
    for (let k = byFraction.length - 1; k >= 0 && left < 0; k--) {
      const i = byFraction[k].i;
      if (out[i] > 0) {
        out[i] -= 1;
        left += 1;
        taken = true;
      }
    }
    if (!taken) break;
  }

  for (let k = 0; left > 0; k = (k + 1) % out.length, left--) {
    out[byFraction[k].i] += 1;
  }

  return out;
}

/**
 * Distribute `total` units proportionally to `weights`, giving every entry at
 * least 1 unit. Used when re-splitting the pool after a manual edit.
 */
function allocateProportionalWithMin(
  weights: readonly number[],
  total: number,
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (total < n) {
    throw new Error(`Cannot give ${n} qualities at least 1 unit from ${total}`);
  }

  const extra = total - n;
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw =
    sum > 0
      ? weights.map((w) => (w / sum) * extra)
      : weights.map(() => extra / n);

  return largestRemainder(raw, extra).map((v) => v + 1);
}

/**
 * Start-of-survey weights: proportional to the 1–5 quality indexes, then
 * rounded to the integer pool (§2.2, step 3).
 */
export function proportionalWeights(
  indexes: readonly number[],
  pool: number,
): number[] {
  if (indexes.length === 0) return [];
  const sum = indexes.reduce((a, b) => a + b, 0);

  if (!(sum > 0)) return uniformWeights(indexes.length);

  const raw = indexes.map((v) => (v / sum) * pool);
  const weights = largestRemainder(raw, pool);

  // A mean index is always ≥ 1, so this should not trigger, but keep the
  // invariant explicit: every cell keeps at least one unit.
  const short = weights.reduce((acc, w) => acc + (w < 1 ? 1 - w : 0), 0);
  if (short > 0) {
    let excess = short;
    for (let i = 0; i < weights.length && excess > 0; i++) {
      const take = Math.min(excess, Math.max(0, weights[i] - 1));
      weights[i] -= take;
      excess -= take;
    }
    for (let i = 0; i < weights.length && excess > 0; i++) {
      if (weights[i] < 1) {
        const give = Math.min(excess, 1 - weights[i]);
        weights[i] += give;
        excess -= give;
      }
    }
  }

  return weights;
}

/** Human-readable validation problems; empty array means the vector is valid. */
export function validateWeights(
  weights: WeightVector,
  count: number,
): string[] {
  const errors: string[] = [];
  const pool = poolFor(count);
  const max = maxWeightFor(count);

  if (weights.length !== count) {
    errors.push(`Ожидалось ${count} качеств, получено ${weights.length}.`);
    return errors;
  }

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!Number.isInteger(w)) {
      errors.push(`Вес качества ${i + 1} должен быть целым числом.`);
    } else if (w < 1) {
      errors.push(`Вес качества ${i + 1} не может быть меньше 1.`);
    } else if (w > max) {
      errors.push(`Вес качества ${i + 1} не может быть больше ${max}.`);
    }
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum !== pool) {
    errors.push(`Сумма весов должна быть ${pool}, сейчас ${sum}.`);
  }

  return errors;
}

/**
 * Change one quality's weight and rebalance all the others so the pool is
 * preserved. Returns a new array; the input is not mutated.
 *
 * The edited value is clamped to `[1, maxWeightFor(count)]`. The remaining
 * units are redistributed proportionally to the other weights, every other
 * quality keeping at least 1.
 */
export function setWeight(
  weights: WeightVector,
  index: number,
  next: number,
  count: number,
): number[] {
  if (index < 0 || index >= weights.length) {
    throw new Error(`Quality index ${index} is out of range`);
  }

  const pool = poolFor(count);
  const clamped = Math.min(
    maxWeightFor(count),
    Math.max(1, Math.round(next)),
  );

  const others = weights.filter((_, i) => i !== index);
  const restTotal = pool - clamped;
  const redistributed = allocateProportionalWithMin(others, restTotal);

  const result: number[] = [];
  let cursor = 0;
  for (let i = 0; i < weights.length; i++) {
    result.push(i === index ? clamped : redistributed[cursor++]);
  }
  return result;
}
