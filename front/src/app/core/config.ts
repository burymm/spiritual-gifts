/**
 * Product constants agreed in docs/Контекст проекта.md.
 * Keep this file as the single place to tune thresholds and the survey scope.
 */

/**
 * Include the candidate questions №201–214 in the survey.
 *
 * They are the only source of answers for qualities 9, 10 and 23 beyond a
 * handful of original questions, but their inclusion is still an open editorial
 * question (см. «Редакторская готовность анкеты»). Flip to `false` to run the
 * approved core set only — dataset, completeness gate and coverage all follow.
 */
export const INCLUDE_CANDIDATE_QUESTIONS = true;

/** Uniform target weight per quality; the pool is BASE_WEIGHT × quality count. */
export const BASE_WEIGHT = 20;

/** Displayed score ≥ this is marked as a strong expression (решение 26.10.2026). */
export const STRONG_THRESHOLD = 75;

/** Displayed score < this is marked as a weak zone. */
export const WEAK_THRESHOLD = 50;

/** How many gifts are shown as the highlighted top list. */
export const TOP_N = 3;
