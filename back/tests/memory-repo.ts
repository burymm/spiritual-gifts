import { randomUUID } from 'node:crypto';

import type { Profile } from '../src/domain/profile.js';
import type { NewProfileInput, ProfileRepository } from '../src/repo/types.js';

/**
 * Хранилище в памяти: нужно только тестам роутов, чтобы проверять API без
 * живой базы. Сам Postgres проверяется отдельно — миграции + smoke-сценарий.
 */
export class MemoryProfileRepository implements ProfileRepository {
  private readonly rows = new Map<string, Profile>();
  private healthy = true;

  setHealthy(value: boolean): void {
    this.healthy = value;
  }

  async create(input: NewProfileInput): Promise<Profile> {
    const now = new Date().toISOString();
    const profile: Profile = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.rows.set(profile.id, profile);
    return profile;
  }

  async findById(id: string): Promise<Profile | null> {
    return this.rows.get(id) ?? null;
  }

  async findLatestByOwner(ownerEmail: string): Promise<Profile | null> {
    const owned = [...this.rows.values()]
      .filter((profile) => profile.ownerEmail === ownerEmail)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return owned[0] ?? null;
  }

  async listLatest(): Promise<Profile[]> {
    const latest = new Map<string, Profile>();
    for (const profile of this.rows.values()) {
      if (profile.ownerEmail === null) continue;
      const current = latest.get(profile.ownerEmail);
      if (current === undefined || profile.updatedAt > current.updatedAt) {
        latest.set(profile.ownerEmail, profile);
      }
    }
    return [...latest.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async update(id: string, patch: NewProfileInput): Promise<Profile | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: Profile = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async ping(): Promise<boolean> {
    return this.healthy;
  }
}