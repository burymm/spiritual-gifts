import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';

import { API_BASE_URL } from './config';
import type { InviteRole, ReceivedEvaluation } from './invite-api.service';
import type { StoredProfile } from './profile-api.service';

/** Назначенный пастор — почта и служебные данные для списка админки. */
export interface Pastor {
  readonly email: string;
  readonly assignedAt: string;
  readonly assignedBy: string | null;
}

/** Ответ на «я пастор?»: роль живёт в базе, а не в токене. */
export interface PastorStatus {
  readonly pastor: boolean;
  readonly assignedAt: string | null;
}

/**
 * Человек, который прислал пастору анкету на оценку: это и есть «свои люди».
 * Профиля может не быть — тогда человек ещё не заполнил анкету.
 */
export interface PastorMember {
  readonly email: string;
  readonly invitedAt: string;
  /** В какой роли пастора позвали: пастор или друг. */
  readonly role: InviteRole;
  readonly profile: StoredProfile | null;
  readonly evaluations: readonly ReceivedEvaluation[];
}

/** Тонкая обёртка над /api/pastors и /api/admin/pastors. */
@Injectable({ providedIn: 'root' })
export class PastorApi {
  private readonly http = inject(HttpClient);

  /** Назначен ли вошедший пастором; без входа сервер отвечает 401. */
  me(): Promise<PastorStatus> {
    return firstValueFrom(
      this.http.get<PastorStatus>(`${API_BASE_URL}/pastors/me`),
    );
  }

  /**
   * Люди, которые прислали этому пастору анкету, с их профилями и
   * присланными оценками; 403 — вошедший не назначен пастором.
   */
  members(): Promise<readonly PastorMember[]> {
    return firstValueFrom(
      this.http
        .get<{ members: PastorMember[] }>(`${API_BASE_URL}/pastor/profiles`)
        .pipe(map((response) => response.members)),
    );
  }

  /** Все назначенные пасторы; сервер пускает только администратора. */
  list(): Promise<Pastor[]> {
    return firstValueFrom(
      this.http.get<{ pastors: Pastor[] }>(`${API_BASE_URL}/admin/pastors`),
    ).then((response) => response.pastors);
  }

  /** Назначить пастора по почте; повторное назначение возвращает ту же запись. */
  assign(email: string): Promise<Pastor> {
    return firstValueFrom(
      this.http.post<Pastor>(`${API_BASE_URL}/admin/pastors`, { email }),
    );
  }

  /** Снять назначение; 404 — этот человек пастором не был. */
  remove(email: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${API_BASE_URL}/admin/pastors/${encodeURIComponent(email)}`,
      ),
    );
  }
}
