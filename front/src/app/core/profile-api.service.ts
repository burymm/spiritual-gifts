import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './config';
import type { AnswerValue, AssessmentResult } from './models';

/** Where the profile came from; same set as in back/src/domain/profile.ts. */
export type StoredSource = AssessmentResult['source'];

/**
 * What we send to the API. `answers` is a sparse question id → 1..5 map,
 * `weights` is the 24-entry vector whose sum equals the pool.
 */
export interface ProfilePayload {
  readonly answers: Record<number, AnswerValue>;
  readonly weights: readonly number[];
  readonly source: StoredSource;
}

export interface StoredProfile extends ProfilePayload {
  readonly id: string;
}

/** Thin wrapper over /api/profiles so callers never see HttpClient types. */
@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly http = inject(HttpClient);

  create(payload: ProfilePayload): Promise<StoredProfile> {
    return firstValueFrom(
      this.http.post<StoredProfile>(`${API_BASE_URL}/profiles`, payload),
    );
  }

  load(id: string): Promise<StoredProfile> {
    return firstValueFrom(
      this.http.get<StoredProfile>(`${API_BASE_URL}/profiles/${id}`),
    );
  }

  /** Профиль вошедшего пользователя; 404 — у почты пока ничего нет. */
  mine(): Promise<StoredProfile> {
    return firstValueFrom(
      this.http.get<StoredProfile>(`${API_BASE_URL}/profiles/mine`),
    );
  }

  update(id: string, payload: ProfilePayload): Promise<StoredProfile> {
    return firstValueFrom(
      this.http.patch<StoredProfile>(`${API_BASE_URL}/profiles/${id}`, payload),
    );
  }
}

/** HTTP status of a failed call, or 0 when the request never reached the API. */
export function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 0;
}
