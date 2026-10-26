import type { Answers, Quality, QualityIndex, Question } from '../models';

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
