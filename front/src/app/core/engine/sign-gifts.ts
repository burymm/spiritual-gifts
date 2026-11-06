import type { Answers } from '../models';

/**
 * Direct question ranges for the four sign gifts.
 *
 * Working hypothesis based on the order of the 161–200 block in the survey:
 * healing first, then miracles, tongues and interpretation. The block is not
 * used for the behavioural quality indexes; these ranges are its only scoring
 * use. Verify the ranges with the owner before treating them as final.
 */
export const SIGN_GIFT_QUESTIONS: Readonly<Record<number, readonly number[]>> =
  {
    19: range(161, 169), // Исцеление
    20: range(170, 180), // Чудотворение
    21: range(181, 190), // Разные языки
    22: range(191, 200), // Истолкование языков
  };

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * Mean answer of each sign gift's direct questions, shown as a percentage
 * (4 из 5 = 80%). Gifts with no answered questions are omitted.
 */
export function signGiftExpressions(
  answers: Answers,
): ReadonlyMap<number, number> {
  const expressions = new Map<number, number>();

  for (const [giftId, questionIds] of Object.entries(SIGN_GIFT_QUESTIONS)) {
    let sum = 0;
    let answered = 0;

    for (const questionId of questionIds) {
      const value = answers[questionId];
      if (value != null && value >= 1 && value <= 5) {
        sum += value;
        answered++;
      }
    }

    if (answered > 0) {
      expressions.set(Number(giftId), (sum / answered / 5) * 100);
    }
  }

  return expressions;
}
