import { describe, expect, it } from 'vitest';

import { BASE_WEIGHT } from '../src/app/core/config';
import { buildMosaic } from '../src/app/features/diagram/mosaic';
import { AssessmentStore } from '../src/app/state/assessment.store';

const SIZE = 12;
const NEIGHBOUR_DISTANCE = Math.sqrt(3) * SIZE;

function countComponents(
  cells: readonly { qualityIndex: number; cx: number; cy: number }[],
  qualityIndex: number,
): number {
  const own = cells.filter((cell) => cell.qualityIndex === qualityIndex);
  const seen = new Set<number>();
  let groups = 0;

  for (let start = 0; start < own.length; start++) {
    if (seen.has(start)) continue;
    groups += 1;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (let i = 0; i < own.length; i++) {
        if (seen.has(i)) continue;
        const distance = Math.hypot(
          own[i].cx - own[current].cx,
          own[i].cy - own[current].cy,
        );
        if (Math.abs(distance - NEIGHBOUR_DISTANCE) < 0.6) {
          seen.add(i);
          queue.push(i);
        }
      }
    }
  }

  return groups;
}

function completeSurvey(store: AssessmentStore, strongQuality = 0): void {
  const qualities = store.dataset.qualities;
  const strongId = qualities[strongQuality].id;

  for (const question of store.dataset.questions) {
    const owner = qualities.find((quality) =>
      quality.questionIds.includes(question.id),
    );
    store.setAnswer(question.id, owner?.id === strongId ? 5 : 1);
  }
}

describe('assessment store', () => {
  it('keeps the uniform profile until every question is answered', () => {
    const store = new AssessmentStore();

    for (const question of store.dataset.questions.slice(0, 10)) {
      store.setAnswer(question.id, 5);
    }

    expect(store.source()).toBe('uniform');
    expect(
      store.weights().every((weight) => weight === BASE_WEIGHT),
    ).toBe(true);
  });

  it('applies a complete survey without leaving the page', () => {
    const store = new AssessmentStore();
    completeSurvey(store);

    expect(store.progress().complete).toBe(true);
    expect(store.source()).toBe('survey');
    expect(store.weights()[0]).toBeGreaterThan(store.weights()[1]);
    expect(store.weights().reduce((a, b) => a + b, 0)).toBe(store.pool);
  });

  it('uses survey indexes for expression, not the diagram weights', () => {
    const store = new AssessmentStore();
    for (const question of store.dataset.questions) {
      store.setAnswer(question.id, 4);
    }

    expect(store.source()).toBe('survey');
    for (const score of store.result().scores) {
      expect(score.display).toBeCloseTo(80, 10);
    }
  });

  it('keeps manual calibration when an answer is edited later', () => {
    const store = new AssessmentStore();
    completeSurvey(store);

    store.setQualityWeight(0, 100);
    expect(store.source()).toBe('calibrated');
    const calibrated = [...store.weights()];

    store.setAnswer(store.dataset.questions[0].id, 3);
    expect(store.weights()).toEqual(calibrated);
    expect(store.source()).toBe('calibrated');
  });

  it('reset returns a complete survey to its own profile', () => {
    const store = new AssessmentStore();
    completeSurvey(store);
    const fromSurvey = [...store.weights()];

    store.setQualityWeight(0, 100);
    store.resetToUniform();
    expect(store.source()).toBe('survey');
    expect(store.weights()).toEqual(fromSurvey);
  });

  it('turns a survey profile into an exact contiguous mosaic', () => {
    const store = new AssessmentStore();
    completeSurvey(store);

    const weights = store.weights();
    const mosaic = buildMosaic(weights, { size: SIZE });
    const counts = new Map<number, number>();
    for (const cell of mosaic.cells) {
      counts.set(cell.qualityIndex, (counts.get(cell.qualityIndex) ?? 0) + 1);
    }

    weights.forEach((weight, index) => {
      expect(counts.get(index), `quality ${index + 1}`).toBe(weight);
      expect(
        countComponents(mosaic.cells, index),
        `quality ${index + 1}`,
      ).toBe(1);
    });
  });

  it('bumps the revision on user changes but not on hydration', () => {
    const store = new AssessmentStore();
    const start = store.revision();

    store.setAnswer(store.dataset.questions[0].id, 4);
    expect(store.revision()).toBeGreaterThan(start);

    const afterEdit = store.revision();
    store.hydrate({
      answers: { 1: 3 },
      weights: Array(store.qualityCount).fill(50),
      source: 'survey',
    });

    // Restoring is not a user change: persistence must not save it back.
    expect(store.revision()).toBe(afterEdit);
    expect(store.answerOf(1)).toBe(3);
    expect(store.source()).toBe('survey');
    expect(store.weights().reduce((a, b) => a + b, 0)).toBe(store.pool);
  });
});
