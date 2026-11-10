import type { Pool } from 'pg';

import type { Evaluation } from '../domain/evaluation.js';
import { newInviteToken, type Invitation } from '../domain/invitation.js';
import type {
  InvitationRepository,
  NewEvaluationInput,
  NewInvitationInput,
} from './types.js';

interface Row {
  id: string;
  token: string;
  email: string;
  role: Invitation['role'];
  owner_email: string;
  created_at: Date | string;
  used_at: Date | string | null;
}

interface EvaluationRow {
  id: string;
  invitation_id: string;
  owner_email: string;
  role: Invitation['role'];
  evaluator_email: string;
  answers: Record<string, number>;
  weights: number[];
  source: Evaluation['source'];
  created_at: Date | string;
}

const EVALUATION_COLUMNS =
  'id, invitation_id, owner_email, role, evaluator_email, answers, weights, source, created_at';

const SELECT_COLUMNS =
  'id, token, email, role, owner_email, created_at, used_at';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toEvaluation(row: EvaluationRow): Evaluation {
  return {
    id: row.id,
    invitationId: row.invitation_id,
    ownerEmail: row.owner_email,
    role: row.role,
    evaluatorEmail: row.evaluator_email,
    answers: row.answers ?? {},
    weights: row.weights ?? [],
    source: row.source,
    createdAt: iso(row.created_at),
  };
}

function toInvitation(row: Row): Invitation {
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    role: row.role,
    ownerEmail: row.owner_email,
    createdAt: iso(row.created_at),
    usedAt: row.used_at === null ? null : iso(row.used_at),
  };
}

/**
 * Приглашения в Postgres. Уникальный частичный индекс
 * (owner_email, email, role) where used_at is null делает вставку
 * идемпотентной: тот же адрес и роль получают ту же ссылку, а не новую
 * запись на каждый ввод почты.
 */
export class PostgresInvitationRepository implements InvitationRepository {
  constructor(private readonly pool: Pool) {}

  async createPending(input: NewInvitationInput): Promise<Invitation> {
    const result = await this.pool.query<Row>(
      `insert into invitations (token, role, email, owner_email)
       values ($1, $2, $3, $4)
       on conflict (owner_email, email, role) where used_at is null
       do update set email = excluded.email
       returning ${SELECT_COLUMNS}`,
      [newInviteToken(), input.role, input.email, input.ownerEmail],
    );
    return toInvitation(result.rows[0]);
  }

  async findByToken(token: string): Promise<Invitation | null> {
    const result = await this.pool.query<Row>(
      `select ${SELECT_COLUMNS} from invitations where token = $1`,
      [token],
    );
    return result.rows[0] ? toInvitation(result.rows[0]) : null;
  }

  async listByOwner(ownerEmail: string): Promise<Invitation[]> {
    const result = await this.pool.query<Row>(
      `select ${SELECT_COLUMNS} from invitations
       where owner_email = $1
       order by created_at desc`,
      [ownerEmail],
    );
    return result.rows.map(toInvitation);
  }

  async listEvaluationsByOwner(ownerEmail: string): Promise<Evaluation[]> {
    const result = await this.pool.query<EvaluationRow>(
      `select ${EVALUATION_COLUMNS} from evaluations
       where owner_email = $1
       order by created_at desc`,
      [ownerEmail],
    );
    return result.rows.map(toEvaluation);
  }

  /** Приглашения, где эта почта — приглашённый: люди, которые её позвали. */
  async listByInvitee(email: string): Promise<Invitation[]> {
    const result = await this.pool.query<Row>(
      `select ${SELECT_COLUMNS} from invitations
       where email = $1
       order by created_at desc`,
      [email],
    );
    return result.rows.map(toInvitation);
  }

  async listAllEvaluations(): Promise<Evaluation[]> {
    const result = await this.pool.query<EvaluationRow>(
      `select ${EVALUATION_COLUMNS} from evaluations order by created_at desc`,
    );
    return result.rows.map(toEvaluation);
  }

  async findEvaluationByToken(token: string): Promise<Evaluation | null> {
    const result = await this.pool.query<EvaluationRow>(
      `select e.id, e.invitation_id, e.owner_email, e.role, e.evaluator_email,
              e.answers, e.weights, e.source, e.created_at
         from evaluations e
         join invitations i on i.id = e.invitation_id
        where i.token = $1`,
      [token],
    );
    return result.rows[0] ? toEvaluation(result.rows[0]) : null;
  }

  /**
   * Отметка used_at и запись оценки — одна транзакция: иначе при сбое ссылка
   * сгорит без ответа, а при гонке двух вкладок появились бы две оценки.
   * `update ... where used_at is null` и решает гонку, и ставит отметку
   * «оценка завершена».
   */
  async recordEvaluation(
    invitationId: string,
    input: NewEvaluationInput,
  ): Promise<Evaluation | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');

      const claimed = await client.query<Row>(
        `update invitations set used_at = now()
         where id = $1 and used_at is null
         returning ${SELECT_COLUMNS}`,
        [invitationId],
      );
      if (claimed.rows[0] === undefined) {
        await client.query('rollback');
        return null;
      }

      const invitation = toInvitation(claimed.rows[0]);
      const inserted = await client.query<EvaluationRow>(
        `insert into evaluations
           (invitation_id, owner_email, role, evaluator_email, answers, weights, source)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
         returning ${EVALUATION_COLUMNS}`,
        [
          invitation.id,
          invitation.ownerEmail,
          invitation.role,
          input.evaluatorEmail,
          JSON.stringify(input.answers),
          JSON.stringify(input.weights),
          input.source,
        ],
      );

      await client.query('commit');
      return toEvaluation(inserted.rows[0]);
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
