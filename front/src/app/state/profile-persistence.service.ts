import { Injectable, Injector, effect, inject } from '@angular/core';

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
 * Keeps the API in sync with the store: restores the saved profile once at
 * startup, then saves (debounced) after every change. No login — the stored
 * profile id in localStorage *is* the access key.
 *
 * Failures are non-fatal: the UI keeps working with local state and the next
 * change retries the save.
 */
@Injectable({ providedIn: 'root' })
export class ProfilePersistence {
  private readonly api = inject(ProfileApi);
  private readonly store = inject(AssessmentStore);
  private readonly injector = inject(Injector);

  private id: string | null = readStoredId();
  /** Blocks saving until the stored profile has been applied (or failed). */
  private restoring = true;
  private changedWhileRestoring = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private rerun = false;

  constructor() {
    effect(
      () => {
        this.store.revision();
        this.onChanged();
      },
      { injector: this.injector },
    );
  }

  /** Loaded by provideAppInitializer, before the first rendered frame. */
  async restore(): Promise<void> {
    try {
      if (this.id !== null) {
        const profile = await this.api.load(this.id);
        this.store.hydrate(profile);
      }
    } catch (error) {
      if (statusOf(error) === 404) {
        // The profile was deleted server-side: start a fresh one on next save.
        this.id = null;
        forgetStoredId();
      } else {
        console.warn('[profile] не удалось загрузить сохранённый профиль', error);
      }
    } finally {
      this.restoring = false;
      if (this.changedWhileRestoring) this.schedule();
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
