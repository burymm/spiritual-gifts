import { computed, Injectable, signal } from '@angular/core';

import type { AnswerValue, AssessmentResult } from '../core/models';
import { DEFAULT_DATASET } from '../core/dataset';
import {
  assess,
  assessWeights,
  poolFor,
  setWeight,
  surveyProgress,
  uniformWeights,
} from '../core/engine';

/**
 * Single source of UI state for the first slice: answers, calibrated weights
 * and the derived assessment. No persistence yet — reloading starts over.
 */
@Injectable({ providedIn: 'root' })
export class AssessmentStore {
  readonly dataset = DEFAULT_DATASET;
  readonly qualities = this.dataset.qualities;
  readonly gifts = this.dataset.gifts;
  readonly clusters = this.dataset.clusters;

  readonly qualityCount = this.qualities.length;
  readonly pool = poolFor(this.qualityCount);

  private readonly _answers = signal<Readonly<Record<number, AnswerValue>>>({});
  private readonly _weights = signal<readonly number[]>(
    uniformWeights(this.qualityCount),
  );
  private readonly _source = signal<AssessmentResult['source']>('uniform');

  readonly answers = this._answers.asReadonly();
  readonly weights = this._weights.asReadonly();
  readonly source = this._source.asReadonly();

  readonly progress = computed(() =>
    surveyProgress(this._answers(), this.dataset.questions),
  );

  readonly result = computed<AssessmentResult>(() =>
    assessWeights(this._weights(), this.dataset, this._source()),
  );

  /** Share of the pool for a quality position, in percent. */
  shareOf(index: number): number {
    return (this._weights()[index] / this.pool) * 100;
  }

  answerOf(questionId: number): AnswerValue | null {
    return this._answers()[questionId] ?? null;
  }

  setAnswer(questionId: number, value: AnswerValue): void {
    this._answers.update((current) => ({ ...current, [questionId]: value }));

    // As soon as the survey is complete the diagram follows it, so it does not
    // matter whether the user leaves the page via the button or the top nav.
    // Manual calibration wins over later answer edits.
    if (this._source() === 'calibrated') return;
    const result = assess(this._answers(), this.dataset);
    if (result.source === 'survey') {
      this._weights.set([...result.weights]);
      this._source.set('survey');
    }
  }

  clearAnswers(): void {
    this._answers.set({});
  }

  /**
   * Turn the survey into diagram weights.
   * Returns `'uniform'` when the survey is incomplete: partial answers are
   * ignored and the diagram starts even (docs §2.2).
   */
  applySurveyToDiagram(): AssessmentResult['source'] {
    const result = assess(this._answers(), this.dataset);
    this._weights.set([...result.weights]);
    this._source.set(result.source);
    return result.source;
  }

  /** Set one weight; the rest of the pool is redistributed automatically. */
  setQualityWeight(index: number, value: number): void {
    this._weights.set(
      setWeight(this._weights(), index, value, this.qualityCount),
    );
    this._source.set('calibrated');
  }

  /** Drop manual calibration: fall back to the survey profile or the even start. */
  resetToUniform(): void {
    const result = assess(this._answers(), this.dataset);
    this._weights.set([...result.weights]);
    this._source.set(result.source);
  }
}
