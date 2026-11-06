/**
 * Product constants agreed in docs/Контекст проекта.md.
 * Keep this file as the single place to tune thresholds and the survey scope.
 */

import { environment } from '../../environments/environment';

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
export const BASE_WEIGHT = 50;

/**
 * Do not use the sign block (questions 161–200) for quality indexes.
 *
 * The 40 questions about healing, miracles, tongues and interpretation are
 * spread across 21 qualities. A person without those gifts answers «1» and
 * thereby lowers unrelated behavioural qualities (решение 06.11.2026).
 * The questions stay in the survey and still count for completeness.
 */
export const EXCLUDE_SIGN_BLOCK_FROM_QUALITIES = true;

/** Inclusive range of the sign block in the questionnaire. */
export const SIGN_BLOCK_FIRST = 161;
export const SIGN_BLOCK_LAST = 200;

/** Displayed score ≥ this is marked as a strong expression (решение 26.10.2026). */
export const STRONG_THRESHOLD = 75;

/** Displayed score < this is marked as a weak zone. */
export const WEAK_THRESHOLD = 50;

/**
 * Base URL of the Fastify API (папка back/). В dev это отдельный процесс на
 * :3000 (CORS на бэке разрешает origin фронта, CORS_ORIGIN в back/.env),
 * в проде — относительный `/api`: запрос уходит на тот же origin и попадает
 * на проект бэка через rewrite в front/vercel.json.
 */
export const API_BASE_URL = environment.apiBaseUrl;

/** How many gifts are shown as the highlighted top list. */
export const TOP_N = 3;
