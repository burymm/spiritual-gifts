import { randomUUID } from 'node:crypto';

import type { Evaluation } from '../src/domain/evaluation.js';
import { newInviteToken, type Invitation } from '../src/domain/invitation.js';
import type { Pastor } from '../src/domain/pastor.js';
import type { Profile } from '../src/domain/profile.js';
import type {
  AssignPastorResult,
  InvitationRepository,
  NewEvaluationInput,
  NewInvitationInput,
  NewProfileInput,
  PastorRepository,
  ProfileRepository,
} from '../src/repo/types.js';

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

/** Приглашения в памяти: та же идемпотентность, что у частичного индекса. */
export class MemoryInvitationRepository implements InvitationRepository {
  private readonly rows = new Map<string, Invitation>();
  readonly evaluations: Evaluation[] = [];

  async createPending(input: NewInvitationInput): Promise<Invitation> {
    for (const row of this.rows.values()) {
      if (
        row.ownerEmail === input.ownerEmail &&
        row.email === input.email &&
        row.role === input.role &&
        row.usedAt === null
      ) {
        return row;
      }
    }

    const invitation: Invitation = {
      id: randomUUID(),
      token: newInviteToken(),
      email: input.email,
      role: input.role,
      ownerEmail: input.ownerEmail,
      createdAt: new Date().toISOString(),
      usedAt: null,
    };
    this.rows.set(invitation.token, invitation);
    return invitation;
  }

  async findByToken(token: string): Promise<Invitation | null> {
    return this.rows.get(token) ?? null;
  }

  async listByOwner(ownerEmail: string): Promise<Invitation[]> {
    return [...this.rows.values()]
      .filter((row) => row.ownerEmail === ownerEmail)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listEvaluationsByOwner(ownerEmail: string): Promise<Evaluation[]> {
    return this.evaluations
      .filter((row) => row.ownerEmail === ownerEmail)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByInvitee(email: string): Promise<Invitation[]> {
    return [...this.rows.values()]
      .filter((row) => row.email === email)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAllEvaluations(): Promise<Evaluation[]> {
    return [...this.evaluations].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async findEvaluationByToken(token: string): Promise<Evaluation | null> {
    const invitation = this.rows.get(token);
    if (invitation === undefined) return null;
    return (
      this.evaluations.find((row) => row.invitationId === invitation.id) ?? null
    );
  }

  /** Та же транзакция, что и в Postgres: сначала отметка, потом запись. */
  async recordEvaluation(
    invitationId: string,
    input: NewEvaluationInput,
  ): Promise<Evaluation | null> {
    const entry = [...this.rows.entries()].find(
      ([, row]) => row.id === invitationId,
    );
    if (entry === undefined) return null;
    const [token, invitation] = entry;
    if (invitation.usedAt !== null) return null;

    this.rows.set(token, { ...invitation, usedAt: new Date().toISOString() });
    const evaluation: Evaluation = {
      id: randomUUID(),
      invitationId: invitation.id,
      ownerEmail: invitation.ownerEmail,
      role: invitation.role,
      evaluatorEmail: input.evaluatorEmail,
      answers: input.answers,
      weights: input.weights,
      source: input.source,
      createdAt: new Date().toISOString(),
    };
    this.evaluations.push(evaluation);
    return evaluation;
  }
}

/** Пасторы в памяти: назначение идемпотентно, как и `on conflict do nothing`. */
export class MemoryPastorRepository implements PastorRepository {
  private readonly rows = new Map<string, Pastor>();

  async find(email: string): Promise<Pastor | null> {
    return this.rows.get(email) ?? null;
  }

  async list(): Promise<Pastor[]> {
    return [...this.rows.values()].sort(
      (a, b) =>
        b.assignedAt.localeCompare(a.assignedAt) || a.email.localeCompare(b.email),
    );
  }

  async assign(email: string, assignedBy: string): Promise<AssignPastorResult> {
    const existing = this.rows.get(email);
    if (existing !== undefined) {
      return { pastor: existing, created: false };
    }
    const pastor: Pastor = {
      email,
      assignedAt: new Date().toISOString(),
      assignedBy,
    };
    this.rows.set(email, pastor);
    return { pastor, created: true };
  }

  async remove(email: string): Promise<boolean> {
    return this.rows.delete(email);
  }
}