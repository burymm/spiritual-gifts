import { Injectable, computed, inject, signal } from '@angular/core';

import {
  InviteApi,
  serverMessage,
  type InvitationInfo,
  type InviteRole,
} from '../core/invite-api.service';
import { statusOf } from '../core/profile-api.service';
import { AssessmentState } from './assessment-state';

/**
 * Оценка пригласившего по ссылке: тот же путь — анкета, диаграмма, результат,
 * — но в своём состоянии. Оно отделено от `AssessmentStore`, чтобы ответы
 * оценщика не уехали в его собственный профиль, и живёт до отправки: шаги
 * ходят по адресам `/invite/<token>/…`, а веса остаются здесь.
 *
 * Почта оценщика берётся сервером из сессии, поэтому отправка требует входа.
 * `completed` — ссылка уже пройдена: после отправки сервер ставит `used_at`.
 */
@Injectable({ providedIn: 'root' })
export class EvaluationStore extends AssessmentState {
  private readonly invites = inject(InviteApi);

  private readonly _token = signal<string | null>(null);
  readonly token = this._token.asReadonly();

  readonly role = signal<InviteRole | null>(null);
  /** true — по ссылке уже ответили, второй оценки не будет. */
  readonly completed = signal(false);
  readonly submitted = signal(false);
  /** Когда оценка ушла владельцу; null — ещё не отправляли. */
  readonly submittedAt = signal<string | null>(null);
  /** Идёт загрузка уже отправленной оценки (экран «вы уже прошли»). */
  readonly loadingSubmitted = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly roleLabel = computed(() =>
    this.role() === 'pastor' ? 'пастора' : 'друга',
  );

  /**
   * Загрузить приглашение и, если ссылка другая, начать оценку с чистого
   * листа. Возвращает `null`, если ссылка не читается (нет сети/404).
   */
  async open(token: string): Promise<InvitationInfo | null> {
    if (this._token() !== token) {
      this._token.set(token);
      this.reset();
      this.role.set(null);
      this.completed.set(false);
      this.submitted.set(false);
      this.submittedAt.set(null);
      this.busy.set(false);
      this.error.set(null);
    }

    try {
      const info = await this.invites.resolve(token);
      this.role.set(info.role);
      this.completed.set(info.completed);
      return info;
    } catch {
      return null;
    }
  }

  /**
   * Показать уже отправленную по этой ссылке оценку. Возвращает false, если
   * её прислал другой человек (403) или сервер не ответил: тогда результат
   * показывать нельзя — он был бы придуман из равномерного старта.
   */
  async loadSubmitted(token: string): Promise<boolean> {
    this._token.set(token);
    this.loadingSubmitted.set(true);
    try {
      const sent = await this.invites.submitted(token);
      this.role.set(sent.role);
      this.completed.set(true);
      this.submitted.set(true);
      this.submittedAt.set(sent.createdAt);
      this.hydrate({
        answers: sent.answers ?? {},
        weights: sent.weights,
        source: sent.source,
      });
      return true;
    } catch {
      return false;
    } finally {
      this.loadingSubmitted.set(false);
    }
  }

  /** Отправить накопленные ответы и веса владельцу профиля. */
  async submit(): Promise<void> {
    const token = this._token();
    if (token === null || this.busy() || this.submitted()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      await this.invites.evaluate(token, {
        answers: { ...this.answers() },
        weights: [...this.weights()],
        source: this.source(),
      });
      this.submitted.set(true);
      this.completed.set(true);
      this.submittedAt.set(new Date().toISOString());
    } catch (error) {
      // 409 — ссылку уже прошли (например, в другой вкладке): это не сбой.
      if (statusOf(error) === 409) {
        this.submitted.set(true);
        this.completed.set(true);
        this.submittedAt.set(new Date().toISOString());
        return;
      }
      this.error.set(
        serverMessage(error, 'Не удалось отправить оценку: сервер не ответил.'),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
