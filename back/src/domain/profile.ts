import { z } from 'zod';

export const SOURCES = ['uniform', 'survey', 'calibrated', 'aggregate'] as const;
export type Source = (typeof SOURCES)[number];

/** Должно совпадать с front/src/app/core/config.ts. */
export interface WeightRules {
  readonly qualityCount: number;
  readonly baseWeight: number;
}

export interface Profile {
  readonly id: string;
  readonly title: string | null;
  readonly answers: Record<string, number>;
  readonly weights: number[];
  readonly source: Source;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type NewProfile = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;

export function poolFor(rules: WeightRules): number {
  return rules.qualityCount * rules.baseWeight;
}

export function maxWeightFor(rules: WeightRules): number {
  return poolFor(rules) - rules.qualityCount;
}

const MAX_ANSWERED_QUESTIONS = 500;

/**
 * Проверки, зеркальные движку фронта: 24 целых веса, каждый от 1 до
 * `pool − count`, сумма ровно пулу (1200 при текущих настройках), ответы —
 * целые 1…5 по числовым id вопросов.
 */
export function createSchemas(rules: WeightRules) {
  const pool = poolFor(rules);
  const max = maxWeightFor(rules);

  const answers = z
    .record(
      z.string().regex(/^\d+$/, 'Ключ ответа должен быть числовым id вопроса'),
      z.number().int().min(1).max(5, 'Ответ должен быть от 1 до 5'),
    )
    .refine(
      (value) => Object.keys(value).length <= MAX_ANSWERED_QUESTIONS,
      `Больше ${MAX_ANSWERED_QUESTIONS} ответов в одном профиле`,
    );

  const weights = z
    .array(
      z
        .number()
        .int('Вес должен быть целым числом')
        .min(1, 'Вес не может быть меньше 1')
        .max(max, `Вес не может быть больше ${max}`),
    )
    .length(rules.qualityCount, `Ожидалось ${rules.qualityCount} качеств`)
    .refine(
      (list) => list.reduce((sum, w) => sum + w, 0) === pool,
      `Сумма весов должна быть ${pool}`,
    );

  const source = z.enum(SOURCES);
  const id = z.string().uuid('Некорректный идентификатор профиля');

  const create = z.object({
    title: z.string().trim().max(200).nullish(),
    answers: answers.optional().default({}),
    weights,
    source: source.default('uniform'),
  });

  const patch = z.object({
    title: z.string().trim().max(200).nullish(),
    answers: answers.optional(),
    weights: weights.optional(),
    source: source.optional(),
  });

  return { create, patch, id, answers, weights, source };
}

export type Schemas = ReturnType<typeof createSchemas>;
export type CreateProfileInput = z.infer<Schemas['create']>;
export type PatchProfileInput = z.infer<Schemas['patch']>;

/** Сообщения ошибок здешние и человеческие — их видит клиент фронта. */
export function issueMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.message);
}