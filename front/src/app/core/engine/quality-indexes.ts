import type {
  Answers,
  GiftProfile,
  Quality,
  QualityIndex,
  Question,
  WeightVector,
} from '../models';
import { BASE_WEIGHT } from '../config';

export interface SurveyProgress {
  readonly answered: number;
  readonly total: number;
  readonly complete: boolean;
  /** 0..1, safe to use for a progress bar. */
  readonly ratio: number;
}

/** Count answered questions. A value must be 1..5 to count as answered. */
export function surveyProgress(
  answers: Answers,
  questions: readonly Question[],
): SurveyProgress {
  let answered = 0;
  for (const q of questions) {
    const a = answers[q.id];
    if (a != null && a >= 1 && a <= 5) answered++;
  }
  const total = questions.length;
  return {
    answered,
    total,
    complete: total > 0 && answered === total,
    ratio: total === 0 ? 0 : answered / total,
  };
}

/**
 * Is the survey complete enough to derive weights?
 *
 * Docs §2.2 «Заполнение анкеты и доступ к диаграмме»: indexes are computed only
 * when the whole questionnaire is filled. One missing answer is enough to
 * discard the partial answers — they are *not* treated as «Никогда».
 */
export function isSurveyComplete(
  answers: Answers,
  questions: readonly Question[],
): boolean {
  return surveyProgress(answers, questions).complete;
}

/**
 * Mean answer per quality on the 1–5 scale.
 *
 * This is descriptive only: `value` is `null` when the quality has no answers,
 * but a non-null value does not mean the whole survey is complete. The
 * assessment uses it only after `isSurveyComplete` passes.
 */
export function qualityIndexes(
  answers: Answers,
  qualities: readonly Quality[],
): QualityIndex[] {
  return qualities.map((quality) => {
    let sum = 0;
    let answered = 0;
    for (const id of quality.questionIds) {
      const a = answers[id];
      if (a != null && a >= 1 && a <= 5) {
        sum += a;
        answered++;
      }
    }
    return {
      qualityId: quality.id,
      value: answered > 0 ? sum / answered : null,
      answered,
    };
  });
}

/** Convenience for tests and the UI: just the numeric values. */
export function indexValues(indexes: readonly QualityIndex[]): number[] {
  return indexes.map((i) => i.value ?? 0);
}

/**
 * How strongly a gift is expressed: its qualities' indexes (1–5) weighted by
 * the gift profile coefficients, then shown as a percentage (4 из 5 = 80%).
 *
 * Missing indexes are skipped; a gift whose qualities are all missing gets 0.
 */
export function giftExpression(
  gift: GiftProfile,
  indexes: readonly QualityIndex[],
): number {
  const byQuality = new Map(indexes.map((i) => [i.qualityId, i.value]));
  let weighted = 0;
  let total = 0;

  for (const [key, coefficient] of Object.entries(gift.weights)) {
    const value = byQuality.get(Number(key));
    if (value == null) continue;
    weighted += coefficient * value;
    total += coefficient;
  }

  return total > 0 ? (weighted / total / 5) * 100 : 0;
}

/**
 * Pseudo-indexes for a manually calibrated weight vector.
 *
 * The diagram stores relative weights, not answers. The mapping keeps the
 * neutral points aligned: BASE_WEIGHT (uniform) → 3 из 5, minimum 1 → 1,
 * maximum → 5. Used only when there are no survey indexes (calibrated and
 * aggregated profiles); the survey path always uses real indexes.
 */
export function pseudoIndexes(
  weights: WeightVector,
  maxWeight: number,
): QualityIndex[] {
  const span = maxWeight - BASE_WEIGHT;

  return weights.map((weight, index) => {
    const value =
      weight <= BASE_WEIGHT
        ? 1 + ((weight - 1) / (BASE_WEIGHT - 1)) * 2
        : span > 0
          ? 3 + ((weight - BASE_WEIGHT) / span) * 2
          : 5;

    return {
      qualityId: index + 1,
      value: Math.min(5, Math.max(1, value)),
      answered: 0,
    };
  });
}
