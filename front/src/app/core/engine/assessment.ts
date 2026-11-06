import type {
  Answers,
  AssessmentResult,
  GiftScore,
  QualityIndex,
  WeightVector,
} from '../models';
import type { Dataset } from '../dataset';
import { STRONG_THRESHOLD, TOP_N, WEAK_THRESHOLD } from '../config';
import { isSurveyComplete, qualityIndexes } from './quality-indexes';
import { signGiftExpressions } from './sign-gifts';
import {
  largestRemainder,
  poolFor,
  proportionalWeights,
  uniformWeights,
  validateWeights,
} from './weights';
import { interpret, scoreGifts } from './scoring';

function buildResult(
  weights: WeightVector,
  dataset: Dataset,
  source: AssessmentResult['source'],
  indexes: readonly QualityIndex[] | null,
  signExpressions: ReadonlyMap<number, number> | null = null,
): AssessmentResult {
  const pool = poolFor(dataset.qualities.length);
  const scores = scoreGifts(
    weights,
    pool,
    dataset.qualities,
    dataset.gifts,
    indexes,
    signExpressions,
  );
  return {
    weights,
    source,
    indexes,
    scores,
    interpretations: interpret(scores, {
      strong: STRONG_THRESHOLD,
      weak: WEAK_THRESHOLD,
      top: TOP_N,
    }),
  };
}

/**
 * Assess a questionnaire.
 *
 * - Complete survey → indexes → proportional weights (§2.2).
 * - Anything less → partial answers are ignored and the diagram starts uniform.
 */
export function assess(answers: Answers, dataset: Dataset): AssessmentResult {
  const pool = poolFor(dataset.qualities.length);
  const complete = isSurveyComplete(answers, dataset.questions);

  if (!complete) {
    return buildResult(
      uniformWeights(dataset.qualities.length),
      dataset,
      'uniform',
      null,
    );
  }

  const indexes = qualityIndexes(answers, dataset.qualities);
  const values = indexes.map((i) => i.value ?? 1);
  const weights = proportionalWeights(values, pool);
  return buildResult(
    weights,
    dataset,
    'survey',
    indexes,
    signGiftExpressions(answers),
  );
}

/** Assess an integer weight vector from the calibration diagram. */
export function assessWeights(
  weights: WeightVector,
  dataset: Dataset,
  source: AssessmentResult['source'] = 'calibrated',
  indexes: readonly QualityIndex[] | null = null,
  signExpressions: ReadonlyMap<number, number> | null = null,
): AssessmentResult {
  const errors = validateWeights(weights, dataset.qualities.length);
  if (errors.length > 0) {
    throw new Error(`Invalid weight vector: ${errors.join(' ')}`);
  }
  return buildResult([...weights], dataset, source, indexes, signExpressions);
}

/**
 * 360° aggregation (docs: «сначала усреднить профили качеств, затем оценить
 * дары»). Each profile participates with equal weight; profiles are normalized
 * to shares before averaging so survey-derived and calibrated vectors can be
 * mixed, then the average share is rounded back to the integer pool.
 */
export function aggregateProfiles(
  profiles: readonly WeightVector[],
  dataset: Dataset,
): number[] {
  const count = dataset.qualities.length;
  const pool = poolFor(count);

  if (profiles.length === 0) return uniformWeights(count);
  for (const profile of profiles) {
    const errors = validateWeights(profile, count);
    if (errors.length > 0) {
      throw new Error(`Invalid profile: ${errors.join(' ')}`);
    }
  }

  const shares = profiles.map((p) => p.map((w) => w / pool));
  const average = Array.from({ length: count }, (_, i) => {
    const sum = shares.reduce((acc, s) => acc + s[i], 0);
    return sum / shares.length;
  });

  return largestRemainder(
    average.map((share) => share * pool),
    pool,
  );
}

/** Assess an averaged 360° profile. */
export function assessAggregate(
  profiles: readonly WeightVector[],
  dataset: Dataset,
): AssessmentResult {
  const weights = aggregateProfiles(profiles, dataset);
  return buildResult(weights, dataset, 'aggregate', null);
}

/** Top-N gift scores, already sorted. */
export function topGifts(
  result: AssessmentResult,
  n = TOP_N,
): readonly GiftScore[] {
  return result.scores.slice(0, n);
}
