/**
 * Engine tests. They pin the numbers that the docs state explicitly so a data
 * or formula change cannot silently drift away from the agreed behaviour.
 */
import { describe, expect, it } from 'vitest';

import type { AnswerValue } from '../src/app/core/models';
import { DEFAULT_DATASET, createDataset } from '../src/app/core/dataset';
import { QUESTIONS } from '../src/app/core/data/questions.data';
import { QUALITIES } from '../src/app/core/data/qualities.data';
import { GIFTS } from '../src/app/core/data/gifts.data';
import { CLUSTERS } from '../src/app/core/data/clusters.data';
import {
  assess,
  assessAggregate,
  assessWeights,
  aggregateProfiles,
  isSurveyComplete,
  largestRemainder,
  poolFor,
  proportionalWeights,
  qualityIndexes,
  setWeight,
  surveyProgress,
  uniformWeights,
  validateWeights,
} from '../src/app/core/engine';

const DATASET = DEFAULT_DATASET;
const N = DATASET.qualities.length;
const POOL = poolFor(N);

function allAnswers(value: AnswerValue): Record<number, AnswerValue> {
  const answers: Record<number, AnswerValue> = {};
  for (const q of DATASET.questions) answers[q.id] = value;
  return answers;
}

/** Profile from docs: 180 + 100 + 80 + 40, the remaining 20 qualities get 4. */
function documentedProfile(): number[] {
  const w = Array.from({ length: N }, () => 4);
  w[5] = 180; // quality 6 — Организаторские способности
  w[6] = 100; // quality 7 — Дисциплинированность
  w[8] = 80; //  quality 9 — Аккуратность
  w[0] = 40; //  quality 1 — Инициативность
  return w;
}

function scoreOf(
  scores: readonly { giftName: string; distance: number; display: number }[],
  name: string,
) {
  const found = scores.find((s) => s.giftName === name);
  if (!found) throw new Error(`gift not found: ${name}`);
  return found;
}

describe('dataset integrity', () => {
  it('has 214 questions (14 of them candidates)', () => {
    expect(QUESTIONS).toHaveLength(214);
    expect(QUESTIONS.filter((q) => q.isCandidate)).toHaveLength(14);
    expect(QUESTIONS.map((q) => q.id)).toEqual(
      Array.from({ length: 214 }, (_, i) => i + 1),
    );
  });

  it('assigns every question to exactly one quality', () => {
    const assigned = QUALITIES.flatMap((q) => q.questionIds);
    expect(assigned).toHaveLength(214);
    expect(new Set(assigned).size).toBe(214);
    expect([...assigned].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 214 }, (_, i) => i + 1),
    );
  });

  it('has 24 qualities covering all 22 gifts', () => {
    expect(QUALITIES).toHaveLength(24);
    expect(GIFTS).toHaveLength(22);

    const qualityIds = new Set(QUALITIES.map((q) => q.id));
    for (const gift of GIFTS) {
      const sum = Object.values(gift.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
      for (const id of Object.keys(gift.weights).map(Number)) {
        expect(qualityIds.has(id), `${gift.name} → quality ${id}`).toBe(true);
      }
    }
  });

  it('groups qualities into clusters 5 + 5 + 6 + 8', () => {
    expect(CLUSTERS.map((c) => c.qualityIds.length)).toEqual([5, 5, 6, 8]);
    const flat = CLUSTERS.flatMap((c) => c.qualityIds).sort((a, b) => a - b);
    expect(flat).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('drops candidate questions from both lists when disabled', () => {
    const core = createDataset({ includeCandidates: false });
    expect(core.questions).toHaveLength(200);
    expect(core.questions.some((q) => q.isCandidate)).toBe(false);
    const assigned = core.qualities.flatMap((q) => q.questionIds);
    expect(assigned.every((id) => id <= 200)).toBe(true);
    expect(new Set(assigned).size).toBe(200);
  });
});

describe('weights', () => {
  it('uniform start is 20 per quality with a 480 pool', () => {
    expect(N).toBe(24);
    expect(POOL).toBe(480);
    expect(uniformWeights(N)).toEqual(Array(24).fill(20));
    expect(uniformWeights(N).reduce((a, b) => a + b, 0)).toBe(480);
  });

  it('largest remainder keeps the exact sum', () => {
    expect(largestRemainder([1.5, 1.5], 3)).toEqual([2, 1]);
    expect(largestRemainder([4, 4, 2], 10)).toEqual([4, 4, 2]);
    expect(largestRemainder([20, 20, 20], 60)).toEqual([20, 20, 20]);
  });

  it('breaks ties towards the smaller quality id', () => {
    expect(largestRemainder([10.5, 10.5, 10.5], 33)).toEqual([11, 11, 11]);
    expect(largestRemainder([0.5, 0.5, 0.5, 0.5], 2)).toEqual([1, 1, 0, 0]);
  });

  it('scales equal indexes to an even diagram', () => {
    expect(proportionalWeights(Array(24).fill(3), 480)).toEqual(
      Array(24).fill(20),
    );
  });

  it('always sums to the pool for uneven indexes', () => {
    const indexes = Array.from({ length: 24 }, (_, i) => 1 + ((i * 7) % 9) / 2);
    const weights = proportionalWeights(indexes, 480);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(480);
    expect(weights.every((w) => w >= 1)).toBe(true);
  });

  it('validates an integer vector against the pool and bounds', () => {
    expect(validateWeights(uniformWeights(N), N)).toEqual([]);
    expect(validateWeights(Array(N).fill(19), N).length).toBeGreaterThan(0);
    expect(
      validateWeights([20.5, ...Array(N - 1).fill(19.5)], N).some((e) =>
        e.includes('целым'),
      ),
    ).toBe(true);
    expect(validateWeights([1, ...Array(N - 1).fill(1)], N).length).toBe(1);
  });

  it('rebalances when one weight changes', () => {
    const start = uniformWeights(N);
    const grown = setWeight(start, 0, 100, N);
    expect(grown[0]).toBe(100);
    expect(grown.reduce((a, b) => a + b, 0)).toBe(480);
    expect(grown.every((w) => w >= 1)).toBe(true);

    const clamped = setWeight(start, 0, 999, N);
    expect(clamped[0]).toBe(456);
    expect(clamped.reduce((a, b) => a + b, 0)).toBe(480);

    const shrunk = setWeight(start, 5, 1, N);
    expect(shrunk[5]).toBe(1);
    expect(shrunk.reduce((a, b) => a + b, 0)).toBe(480);
  });
});

describe('quality indexes and survey completeness', () => {
  it('averages answers per quality', () => {
    const indexes = qualityIndexes(allAnswers(3), DATASET.qualities);
    expect(indexes).toHaveLength(24);
    for (const index of indexes) {
      expect(index.value).toBe(3);
      expect(index.answered).toBe(
        DATASET.qualities.find((q) => q.id === index.qualityId)!.questionIds
          .length,
      );
    }
  });

  it('requires every question before the survey counts as complete', () => {
    const full = allAnswers(3);
    expect(isSurveyComplete(full, DATASET.questions)).toBe(true);

    const partial = { ...full };
    delete partial[214];
    expect(isSurveyComplete(partial, DATASET.questions)).toBe(false);

    const progress = surveyProgress(partial, DATASET.questions);
    expect(progress.answered).toBe(213);
    expect(progress.total).toBe(214);
    expect(progress.ratio).toBeCloseTo(213 / 214, 10);
  });

  it('ignores partial answers and starts uniform', () => {
    const partial = allAnswers(5);
    delete partial[1];

    const result = assess(partial, DATASET);
    expect(result.source).toBe('uniform');
    expect(result.indexes).toBeNull();
    expect(result.weights).toEqual(Array(24).fill(20));
  });

  it('uses the survey when it is complete', () => {
    const result = assess(allAnswers(3), DATASET);
    expect(result.source).toBe('survey');
    expect(result.weights).toEqual(Array(24).fill(20));

    const skewed = allAnswers(1);
    for (const id of DATASET.qualities[0].questionIds) skewed[id] = 5;
    const skewedResult = assess(skewed, DATASET);
    expect(skewedResult.source).toBe('survey');
    expect(skewedResult.weights[0]).toBeGreaterThan(skewedResult.weights[1]);
    expect(skewedResult.weights.reduce((a, b) => a + b, 0)).toBe(480);
  });
});

describe('gift scoring', () => {
  it('reproduces the documented example (Организатор 83,63 / Руководитель 33,41)', () => {
    const weights = documentedProfile();
    expect(weights.reduce((a, b) => a + b, 0)).toBe(480);

    const result = assessWeights(weights, DATASET);
    const organizer = scoreOf(result.scores, 'Организатор / Администратор');
    const leader = scoreOf(result.scores, 'Руководитель');

    expect(organizer.distance).toBeCloseTo(0.1637, 4);
    expect(organizer.display).toBeCloseTo(83.63, 2);
    expect(leader.distance).toBeCloseTo(0.6659, 4);
    expect(leader.display).toBeCloseTo(33.41, 1);
    expect(result.scores[0].giftName).toBe('Организатор / Администратор');
  });

  it('gives Чудотворение 58,37% for the uniform start', () => {
    const result = assessWeights(uniformWeights(N), DATASET);
    expect(result.scores[0].giftName).toBe('Чудотворение');
    expect(result.scores[0].display).toBeCloseTo(58.37, 1);
  });

  it('never displays a negative score', () => {
    const weights = Array.from({ length: N }, () => 1);
    weights[9] = 456; // quality 10 — Финансовая дисциплина
    weights[0] = 2;
    expect(weights.reduce((a, b) => a + b, 0)).toBe(480);

    const result = assessWeights(weights, DATASET);
    expect(result.scores.some((s) => s.score < 0)).toBe(true);
    for (const s of result.scores) {
      expect(s.display).toBeGreaterThanOrEqual(0);
      expect(s.display).toBe(Math.max(0, s.score));
    }
  });

  it('marks top 3 and applies the 75 / 50 thresholds to the display value', () => {
    const strong = assessWeights(documentedProfile(), DATASET);
    expect(strong.interpretations[0].rank).toBe(1);
    expect(strong.interpretations[0].strength).toBe('strong');
    expect(strong.interpretations.filter((i) => i.top)).toHaveLength(3);
    expect(strong.interpretations[3].top).toBe(false);

    const uniform = assessWeights(uniformWeights(N), DATASET);
    expect(uniform.interpretations[0].score.display).toBeCloseTo(58.37, 1);
    expect(uniform.interpretations[0].strength).toBe('possible');

    const weak = uniform.interpretations.find(
      (i) => i.score.display < 50,
    );
    expect(weak?.strength).toBe('weak');
  });
});

describe('360° aggregation', () => {
  it('keeps a single profile as is', () => {
    const uniform = uniformWeights(N);
    expect(aggregateProfiles([uniform], DATASET)).toEqual(uniform);
    expect(aggregateProfiles([uniform, uniform], DATASET)).toEqual(uniform);
  });

  it('averages shares before scoring and keeps the pool', () => {
    const a = uniformWeights(N);
    const b = documentedProfile();
    const merged = aggregateProfiles([a, b], DATASET);

    expect(merged.reduce((x, y) => x + y, 0)).toBe(480);
    expect(merged).not.toEqual(a);
    expect(merged).not.toEqual(b);

    const result = assessAggregate([a, b], DATASET);
    expect(result.source).toBe('aggregate');
    expect(result.scores[0].giftName).toBe('Организатор / Администратор');
  });

  it('rejects an invalid profile', () => {
    expect(() => aggregateProfiles([[1, 2, 3]], DATASET)).toThrow();
  });
});
