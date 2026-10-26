import type { GiftProfile, Quality, QualityCluster, Question } from './models';
import { QUESTIONS } from './data/questions.data';
import { QUALITIES } from './data/qualities.data';
import { GIFTS } from './data/gifts.data';
import { CLUSTERS } from './data/clusters.data';
import { INCLUDE_CANDIDATE_QUESTIONS } from './config';

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
  options: { includeCandidates?: boolean } = {},
): Dataset {
  const includeCandidates =
    options.includeCandidates ?? INCLUDE_CANDIDATE_QUESTIONS;

  const questions = includeCandidates
    ? QUESTIONS
    : QUESTIONS.filter((q) => !q.isCandidate);

  const allowed = new Set(questions.map((q) => q.id));
  const qualities = QUALITIES.map((q) => ({
    ...q,
    questionIds: q.questionIds.filter((id) => allowed.has(id)),
  })).filter((q) => q.questionIds.length > 0);

  return { questions, qualities, gifts: GIFTS, clusters: CLUSTERS };
}

/** Dataset with the currently configured survey scope. */
export const DEFAULT_DATASET: Dataset = createDataset();
