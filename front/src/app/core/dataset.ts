import type { GiftProfile, Quality, QualityCluster, Question } from './models';
import { QUESTIONS } from './data/questions.data';
import { QUALITIES } from './data/qualities.data';
import { GIFTS } from './data/gifts.data';
import { CLUSTERS } from './data/clusters.data';
import {
  EXCLUDE_SIGN_BLOCK_FROM_QUALITIES,
  INCLUDE_CANDIDATE_QUESTIONS,
  SIGN_BLOCK_FIRST,
  SIGN_BLOCK_LAST,
} from './config';

export interface Dataset {
  readonly questions: readonly Question[];
  readonly qualities: readonly Quality[];
  readonly gifts: readonly GiftProfile[];
  readonly clusters: readonly QualityCluster[];
}

/**
 * Build the active dataset.
 *
 * When candidate questions are excluded, they are removed from the question
 * list *and* from the per-quality key. Otherwise the completeness gate would
 * require answers to questions that are not shown to the user.
 */
export function createDataset(
  options: { includeCandidates?: boolean; excludeSignBlock?: boolean } = {},
): Dataset {
  const includeCandidates =
    options.includeCandidates ?? INCLUDE_CANDIDATE_QUESTIONS;
  const excludeSignBlock =
    options.excludeSignBlock ?? EXCLUDE_SIGN_BLOCK_FROM_QUALITIES;

  const questions = includeCandidates
    ? QUESTIONS
    : QUESTIONS.filter((q) => !q.isCandidate);

  const allowed = new Set(questions.map((q) => q.id));
  const isSignBlock = (id: number) =>
    excludeSignBlock && id >= SIGN_BLOCK_FIRST && id <= SIGN_BLOCK_LAST;

  const qualities = QUALITIES.map((q) => ({
    ...q,
    questionIds: q.questionIds.filter(
      (id) => allowed.has(id) && !isSignBlock(id),
    ),
  })).filter((q) => q.questionIds.length > 0);

  return { questions, qualities, gifts: GIFTS, clusters: CLUSTERS };
}

/**
 * Dataset with the currently configured survey scope: candidate questions and
 * the sign block affect the quality key, while the survey still asks all of
 * them (completeness is checked against `questions`).
 */
export const DEFAULT_DATASET: Dataset = createDataset();
