import { Injectable, Injector, effect, inject } from '@angular/core';

import { AuthService } from '../core/auth.service';
import { uniformWeights } from '../core/engine';
import type { ProfilePayload } from '../core/profile-api.service';
import { ProfileApi, statusOf } from '../core/profile-api.service';
import { AssessmentStore } from './assessment.store';

/** Where the profile id lives between visits; the profile itself is server-side. */
const STORAGE_KEY = 'spiritual-gifts:profile-id';
/** Quiet period after the last change before we hit the API. */
const SAVE_DELAY_MS = 800;

function readStoredId(): string | null {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode / storage disabled — the profile simply won't be restored.
  }
}

function forgetStoredId(): void {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See writeStoredId.
  }
}

/** Current store state in the exact shape the API expects. */
export function profilePayloadOf(store: AssessmentStore): ProfilePayload {
  return {
    answers: { ...store.answers() },
    weights: [...store.weights()],
    source: store.source(),
  };
}

/** Nothing worth storing until the user has answered or calibrated something. */
export function hasSomethingToSave(payload: ProfilePayload): boolean {
  return (
    Object.keys(payload.answers).length > 0 || payload.source !== 'uniform'
  );
}

/**
 * Keeps the API in sync with the store: restores the profile once at startup,
 * then saves (debounced) after every change.
 *
 * Профиль всегда привязан к почте: `GET /api/profiles/mine` — главный
 * источник. Локальный профиль, сохранённый до появления обязательного входа,
 * «забирается» аккаунтом первым сохранением.
 *
 * Failures are non-fatal: the UI keeps working with local state and the next
 * change retries the save.
 */
@Injectable({ providedIn: 'root' })
export class ProfilePersistence {
  private readonly api = inject(ProfileApi);
  private readonly store = inject(AssessmentStore);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  private id: string | null = readStoredId();
  /** Blocks saving until the stored profile has been applied (or failed). */
  private restoring = true;
  private changedWhileRestoring = false;
  /** Смена почты просит сохранить локальное состояние — см. onAuthChanged. */
  private pendingSave = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private rerun = false;

  /** Реакция на вход/выход включается только после первого восстановления. */
  private tracking = false;
  private knownEmail: string | null = null;
  /** Первый запуск эффекта — не действие пользователя, а сам эффект. */
  private revisionPrimed = false;

  constructor() {
    effect(
      () => {
        this.store.revision();
        if (!this.revisionPrimed) {
          this.revisionPrimed = true;
          return;
        }
        this.onChanged();
      },
      { injector: this.injector },
    );
    effect(
      () => {
        const email = this.auth.email();
        if (!this.tracking || email === this.knownEmail) return;
        this.knownEmail = email;
        void this.onAuthChanged(email);
      },
      { injector: this.injector },
    );
  }

  /** Loaded by provideAppInitializer, before the first rendered frame. */
  async restore(): Promise<void> {
    let claimAfterLoad = false;
    try {
      // Сначала вход: от того, кто мы, зависит, какой профиль читать.
      await this.auth.restore();

      if (this.auth.email() !== null) {
        const loaded = await this.loadMine();
        // У почты пока нет профиля — берём локальный, он «заберётся» при
        // первом сохранении (см. PATCH с ownerEmail на бэке).
        if (!loaded) claimAfterLoad = await this.loadStored();
      } else {
        await this.loadStored();
      }
    } catch (error) {
      console.warn('[profile] не удалось загрузить сохранённый профиль', error);
    } finally {
      this.knownEmail = this.auth.email();
      this.tracking = true;
      this.restoring = false;
      if (this.changedWhileRestoring || claimAfterLoad) {
        // Флаг потребляем: иначе он повторно сработает при выходе из аккаунта
        // и создаст лишний анонимный профиль.
        this.changedWhileRestoring = false;
        this.schedule();
      }
    }
  }

  /** Профиль почты; false — у почты пока нет сохранённого профиля. */
  private async loadMine(): Promise<boolean> {
    try {
      const mine = await this.api.mine();
      this.id = mine.id;
      writeStoredId(mine.id);
      this.store.hydrate(mine);
      return true;
    } catch (error) {
      if (statusOf(error) === 404) return false;
      // 401 — интерсептор уже погасил протухший токен, дальше без входа.
      if (statusOf(error) !== 401) {
        console.warn('[profile] не удалось загрузить профиль почты', error);
      }
      return false;
    }
  }

  private async loadStored(): Promise<boolean> {
    if (this.id === null) return false;
    try {
      const profile = await this.api.load(this.id);
      this.store.hydrate(profile);
      return true;
    } catch (error) {
      if (statusOf(error) === 404) {
        // The profile was deleted server-side: start a fresh one on next save.
        this.id = null;
        forgetStoredId();
      } else {
        console.warn('[profile] не удалось загрузить сохранённый профиль', error);
      }
      return false;
    }
  }

  /**
   * Вход: серверный профиль почты главный; если его нет — сохраняем то, что
   * уже есть в браузере, чтобы работа первого захода не пропала.
   * Выход: дальше работаем анонимным профилем, состояние не трогаем.
   */
  private async onAuthChanged(email: string | null): Promise<void> {
    // Дожидаемся текущего сохранения: иначе старое локальное состояние
    // может уехать в профиль почты уже после гидратации.
    await this.settle();

    this.restoring = true;
    try {
      if (email === null) {
        // Выход: чужому аккаунту не должны достаться ответы предыдущего.
        this.id = null;
        forgetStoredId();
        this.store.hydrate({
          answers: {},
          weights: uniformWeights(this.store.qualityCount),
          source: 'uniform',
        });
        return;
      }
      if (!(await this.loadMine())) this.pendingSave = true;
    } finally {
      this.restoring = false;
      if (this.pendingSave || this.changedWhileRestoring) {
        this.pendingSave = false;
        this.changedWhileRestoring = false;
        this.schedule();
      }
    }
  }

  /** Ждёт незавершённого запроса и отменяет отложенное сохранение. */
  private async settle(): Promise<void> {
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private onChanged(): void {
    if (this.restoring) {
      this.changedWhileRestoring = true;
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, SAVE_DELAY_MS);
  }

  private async save(): Promise<void> {
    if (this.restoring) return;
    // Без входа сохранять некуда: профили привязаны к почте.
    if (this.auth.email() === null) return;
    if (this.inFlight) {
      // Another save is running: pick up the latest state when it finishes.
      this.rerun = true;
      return;
    }

    const payload = profilePayloadOf(this.store);
    if (!hasSomethingToSave(payload)) return;

    this.inFlight = true;
    try {
      if (this.id === null) {
        const created = await this.api.create(payload);
        this.id = created.id;
        writeStoredId(created.id);
      } else {
        await this.api.update(this.id, payload);
      }
    } catch (error) {
      if (statusOf(error) === 404) {
        // Gone on the server: drop the id so the next attempt creates a new one.
        this.id = null;
        forgetStoredId();
        this.rerun = true;
      } else if (statusOf(error) === 401) {
        // Токен протух: интерсептор его выбросил, профиль создастся заново.
        console.warn('[profile] сессия истекла — сохранение пойдёт после входа');
      } else {
        console.warn('[profile] не удалось сохранить профиль', error);
      }
    } finally {
      this.inFlight = false;
    }

    if (this.rerun) {
      this.rerun = false;
      this.schedule();
    }
  }
}
