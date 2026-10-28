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
 * and the derived assessment. The state is persisted through
 * `ProfilePersistence`: it is saved to the API after each change and restored
 * on the next visit.
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
  /** Increments on every user-driven change; persistence listens to it. */
  private readonly _revision = signal(0);

  readonly answers = this._answers.asReadonly();
  readonly weights = this._weights.asReadonly();
  readonly source = this._source.asReadonly();
  readonly revision = this._revision.asReadonly();

  /** Record a change that persistence should pick up. */
  private touch(): void {
    this._revision.update((value) => value + 1);
  }

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
    this.touch();

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
    this.touch();
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
    this.touch();
    return result.source;
  }

  /** Set one weight; the rest of the pool is redistributed automatically. */
  setQualityWeight(index: number, value: number): void {
    this._weights.set(
      setWeight(this._weights(), index, value, this.qualityCount),
    );
    this._source.set('calibrated');
    this.touch();
  }

  /** Drop manual calibration: fall back to the survey profile or the even start. */
  resetToUniform(): void {
    const result = assess(this._answers(), this.dataset);
    this._weights.set([...result.weights]);
    this._source.set(result.source);
    this.touch();
  }

  /**
   * Replace the whole state with a stored profile (restoration on load).
   * Deliberately does not touch `revision`: restoring is not a user change,
   * so persistence must not save right back.
   */
  hydrate(profile: {
    readonly answers: Readonly<Record<number, AnswerValue>>;
    readonly weights: readonly number[];
    readonly source: AssessmentResult['source'];
  }): void {
    this._answers.set({ ...profile.answers });
    this._weights.set([...profile.weights]);
    this._source.set(profile.source);
  }
}
