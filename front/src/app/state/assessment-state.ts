import { InjectionToken, computed, signal } from '@angular/core';

import type { AnswerValue, AssessmentResult } from '../core/models';
import { DEFAULT_DATASET } from '../core/dataset';
import {
  assess,
  assessWeights,
  isSurveyComplete,
  poolFor,
  qualityIndexes,
  setWeight,
  signGiftExpressions,
  surveyProgress,
  uniformWeights,
} from '../core/engine';

/**
 * Состояние разбора анкеты и весов — общее для двух режимов: своя карта
 * (`AssessmentStore`) и оценка пригласившего по ссылке (`EvaluationStore`).
 *
 * В режиме оценки тот же движок считает результат по чужим качествам, но
 * состояние живёт отдельно: иначе ответы оценщика перезаписали бы его
 * собственный профиль.
 */
export abstract class AssessmentState {
  readonly dataset = DEFAULT_DATASET;
  readonly qualities = this.dataset.qualities;
  readonly gifts = this.dataset.gifts;
  readonly clusters = this.dataset.clusters;

  readonly qualityCount = this.qualities.length;
  readonly pool = poolFor(this.qualityCount);

  protected readonly _answers = signal<Readonly<Record<number, AnswerValue>>>(
    {},
  );
  protected readonly _weights = signal<readonly number[]>(
    uniformWeights(this.qualityCount),
  );
  protected readonly _source = signal<AssessmentResult['source']>('uniform');
  /** Меняется на каждое действие пользователя; сохранение слушает его. */
  protected readonly _revision = signal(0);

  readonly answers = this._answers.asReadonly();
  readonly weights = this._weights.asReadonly();
  readonly source = this._source.asReadonly();
  readonly revision = this._revision.asReadonly();

  /** Отметить изменение, которое должно попасть в сохранение. */
  protected touch(): void {
    this._revision.update((value) => value + 1);
  }

  readonly progress = computed(() =>
    surveyProgress(this._answers(), this.dataset.questions),
  );

  readonly result = computed<AssessmentResult>(() => {
    // Expression comes from the real answers, not from a lossy conversion of
    // the diagram weights. Calibrated and aggregated profiles have no answers
    // and fall back to pseudo-indexes inside the engine.
    const complete =
      this._source() === 'survey' &&
      isSurveyComplete(this._answers(), this.dataset.questions);
    const indexes = complete
      ? qualityIndexes(this._answers(), this.qualities)
      : null;
    const signExpressions = complete
      ? signGiftExpressions(this._answers())
      : null;

    return assessWeights(
      this._weights(),
      this.dataset,
      this._source(),
      indexes,
      signExpressions,
    );
  });

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

  /** Начать с чистого листа: ответов нет, веса разложены поровну. */
  reset(): void {
    this.hydrate({
      answers: {},
      weights: uniformWeights(this.qualityCount),
      source: 'uniform',
    });
  }
}

/**
 * Что видят страницы анкеты, диаграммы и результата. Свои разделы отдают
 * `AssessmentStore`, ссылка-приглашение — `EvaluationStore`.
 */
export const ASSESSMENT_STATE = new InjectionToken<AssessmentState>(
  'AssessmentState',
);
