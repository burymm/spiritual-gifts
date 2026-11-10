import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { map, timeout } from 'rxjs/operators';

import { API_BASE_URL } from './config';
import type { AnswerValue, AssessmentResult } from './models';

/** Кого приглашают оценить профиль: пастор или друг. */
export type InviteRole = 'pastor' | 'friend';

/** Сколько ждём статистику оценок, прежде чем показать ошибку. */
const STATS_TIMEOUT_MS = 10_000;

/**
 * Приглашение из базы. Ссылки в записи нет: её собирает фронт из token,
 * потому что origin у локальной сборки и продакшена разный.
 */
export interface Invitation {
  readonly token: string;
  readonly email: string;
  readonly role: InviteRole;
}

/** Публичный ответ по токену: только роль, без почт. */
export interface InvitationInfo {
  readonly role: InviteRole;
  /** true — оценка уже прислана, ссылка одноразовая. */
  readonly completed: boolean;
}

/**
 * Что отправляет приглашённый: та же диаграмма, что и в самооценке — пул
 * весов по качествам. Почту оценщика сервер берёт из сессии.
 */
export interface EvaluationPayload {
  readonly answers: Record<number, AnswerValue>;
  readonly weights: readonly number[];
  readonly source: AssessmentResult['source'];
}

/** Ссылка из списка владельца: `usedAt` — уже ответили, ссылка закрыта. */
export interface MyInvitation {
  readonly token: string;
  readonly email: string;
  readonly role: InviteRole;
  readonly createdAt: string;
  readonly usedAt: string | null;
}

/**
 * Присланная оценка — голос в среднем результате. Почты оценщика здесь нет:
 * 360° анонимен, роли достаточно, чтобы объяснить вклад.
 */
export interface ReceivedEvaluation {
  readonly id: string;
  readonly role: InviteRole;
  readonly source: AssessmentResult['source'];
  readonly weights: readonly number[];
  readonly createdAt: string;
}

/** Своя отправленная оценка: только она открывается по токену повторно. */
export interface SubmittedEvaluation extends EvaluationPayload {
  readonly role: InviteRole;
  readonly createdAt: string;
}

/**
 * Приглашения живут в базе: ссылка выдаётся после записи, ключ — случайный
 * токен, а роль и почта приглашённого в URL не попадают.
 */
@Injectable({ providedIn: 'root' })
export class InviteApi {
  private readonly http = inject(HttpClient);

  /** Создать приглашение; для той же почты и роли вернётся уже выданное. */
  create(email: string, role: InviteRole): Promise<Invitation> {
    return firstValueFrom(
      this.http.post<Invitation>(`${API_BASE_URL}/invitations`, { email, role }),
    );
  }

  /** Роль по токену; 404 — ссылка не наша или скопирована не полностью. */
  resolve(token: string): Promise<InvitationInfo> {
    return firstValueFrom(
      this.http.get<InvitationInfo>(
        `${API_BASE_URL}/invitations/${encodeURIComponent(token)}`,
      ),
    );
  }

  /** Отправить оценку по ссылке; вторую оценку сервер не примет (409). */
  evaluate(token: string, payload: EvaluationPayload): Promise<InvitationInfo> {
    return firstValueFrom(
      this.http.post<InvitationInfo>(
        `${API_BASE_URL}/invitations/${encodeURIComponent(token)}/evaluation`,
        payload,
      ),
    );
  }

  /**
   * Ссылки вошедшего владельца — со статусом «ждём ответа» / «получена».
   * Таймаут: зависший запрос не должен навсегда оставлять страницу в
   * состоянии «проверяем оценки…» — лучше показать ошибку и кнопку «Обновить».
   */
  mine(): Promise<readonly MyInvitation[]> {
    return firstValueFrom(
      this.http
        .get<{ invitations: MyInvitation[] }>(`${API_BASE_URL}/invitations/mine`)
        .pipe(
          timeout(STATS_TIMEOUT_MS),
          map((response) => response.invitations),
        ),
    );
  }

  /** Оценки, присланные владельцу: из них складывается средний результат. */
  received(): Promise<readonly ReceivedEvaluation[]> {
    return firstValueFrom(
      this.http
        .get<{ evaluations: ReceivedEvaluation[] }>(
          `${API_BASE_URL}/evaluations/mine`,
        )
        .pipe(
          timeout(STATS_TIMEOUT_MS),
          map((response) => response.evaluations),
        ),
    );
  }

  /** Своя отправленная оценка; 403 — оценка прислана не этим человеком. */
  submitted(token: string): Promise<SubmittedEvaluation> {
    return firstValueFrom(
      this.http.get<SubmittedEvaluation>(
        `${API_BASE_URL}/invitations/${encodeURIComponent(token)}/evaluation`,
      ),
    );
  }
}

/** Сообщение сервера, если оно есть (иначе — запасное). */
export function serverMessage(error: unknown, fallback: string): string {
  const message = (error as { error?: { error?: unknown } } | null)?.error?.error;
  return typeof message === 'string' && message.trim() !== '' ? message : fallback;
}
