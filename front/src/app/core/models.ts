/**
 * Domain types for the spiritual-gifts assessment.
 *
 * Canonical values live in `core/data/*.data.ts`, which are generated from the
 * Markdown sources in `docs/`. Those Markdown files are the source of truth.
 */

/** Quality id, 1..24. */
export type QualityId = number;
/** Question id, 1..214. */
export type QuestionId = number;

/** Answer on the 1..5 scale: 1 = Никогда … 5 = Всегда. */
export type AnswerValue = 1 | 2 | 3 | 4 | 5;

/** Sparse map of question id → answer. Missing / null = not answered. */
export type Answers = Readonly<Record<QuestionId, AnswerValue | null | undefined>>;

export interface Question {
  readonly id: QuestionId;
  readonly text: string;
  /** Editorial tags from the survey source. */
  readonly tags: readonly string[];
  /** Candidate questions 201–214 are not part of the approved core set. */
  readonly isCandidate: boolean;
}

export interface Quality {
  readonly id: QualityId;
  readonly name: string;
  readonly questionIds: readonly QuestionId[];
}

export interface GiftProfile {
  readonly id: number;
  readonly name: string;
  /** Quality id → ideal coefficient. Sums to 1.0 (working hypothesis). */
  readonly weights: Readonly<Record<QualityId, number>>;
  /** Short rationale shown in the UI. */
  readonly basis: string;
}

export interface QualityCluster {
  readonly id: number;
  readonly name: string;
  readonly subtitle: string;
  readonly qualityIds: readonly QualityId[];
}

/** Computed index of one quality (mean of its answered questions). */
export interface QualityIndex {
  readonly qualityId: QualityId;
  /** Mean answer on the 1..5 scale, or `null` when the quality has no answers. */
  readonly value: number | null;
  readonly answered: number;
}

/** Integer weight vector, one entry per quality (24 entries). */
export type WeightVector = readonly number[];

export interface GiftScore {
  readonly giftId: number;
  readonly giftName: string;
  /** Euclidean distance between the normalized weight vector and the profile. */
  readonly distance: number;
  /** Profile match `(1 − distance) × 100`, computed literally. May be negative. */
  readonly match: number;
  /**
   * Weighted mean of the gift's quality indexes on the 1–5 scale, in percent:
   * `mean / 5 × 100`. This is the primary result (4 из 5 = 80%).
   */
  readonly expression: number;
  /** Percent shown in the UI: `expression` clamped to 0…100. */
  readonly display: number;
}

export type GiftStrength = 'strong' | 'possible' | 'weak';

export interface GiftInterpretation {
  readonly score: GiftScore;
  readonly rank: number;
  readonly strength: GiftStrength;
  /** True for the first three gifts by score. */
  readonly top: boolean;
}

export interface AssessmentResult {
  /** Normalized weight vector (each entry / pool size, sum = 1). */
  readonly weights: WeightVector;
  /**
   * Where the profile came from: a completed survey, the uniform start, a manual
   * calibration, or an averaged 360° profile.
   */
  readonly source: 'survey' | 'uniform' | 'calibrated' | 'aggregate';
  /** Per-quality indexes; `null` unless the survey was complete. */
  readonly indexes: readonly QualityIndex[] | null;
  /** All 22 gifts, sorted by score descending (stable by gift id on ties). */
  readonly scores: readonly GiftScore[];
  readonly interpretations: readonly GiftInterpretation[];
}
