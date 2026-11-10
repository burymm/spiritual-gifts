import type { InvitationRole } from './invitation.js';
import type { Source } from './profile.js';

/**
 * Оценка, присланная по ссылке: пастор или друг раскладывает пул весов по
 * качествам пригласившего. Ответы на вопросы пока не спрашиваем — оценка
 * приходит уже взвешенной диаграммой (`source: 'calibrated'`), но поле
 * оставлено, чтобы приём анкеты по ссылке не менял схему таблицы.
 */
export interface EvaluationInput {
  readonly answers: Record<string, number>;
  readonly weights: number[];
  readonly source: Source;
}

export interface Evaluation extends EvaluationInput {
  readonly id: string;
  readonly invitationId: string;
  /** Кого оценили — почта пригласившего из записи приглашения. */
  readonly ownerEmail: string;
  readonly role: InvitationRole;
  /** Кто оценил — почта из сессии, а не из тела запроса. */
  readonly evaluatorEmail: string;
  readonly createdAt: string;
}
