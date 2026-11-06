import type { Pool } from 'pg';

import type { Profile, Source } from '../domain/profile.js';
import type { NewProfileInput, ProfileRepository } from './types.js';

interface Row {
  id: string;
  title: string | null;
  answers: Record<string, number>;
  weights: number[];
  source: Source;
  owner_email: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const SELECT_COLUMNS =
  'id, title, answers, weights, source, owner_email, created_at, updated_at';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toProfile(row: Row): Profile {
  return {
    id: row.id,
    title: row.title,
    answers: row.answers ?? {},
    weights: row.weights ?? [],
    source: row.source,
    ownerEmail: row.owner_email ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * Обычный Postgres через `pg`: работает и с Supabase (session pooler), и с
 * Postgres на VPS — схема и запросы не привязаны к конкретному хостингу.
 */
export class PostgresProfileRepository implements ProfileRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewProfileInput): Promise<Profile> {
    const result = await this.pool.query<Row>(
      `insert into profiles (title, answers, weights, source, owner_email)
       values ($1, $2::jsonb, $3::jsonb, $4, $5)
       returning ${SELECT_COLUMNS}`,
      [
        input.title,
        JSON.stringify(input.answers),
        JSON.stringify(input.weights),
        input.source,
        input.ownerEmail,
      ],
    );
    return toProfile(result.rows[0]);
  }

  async findById(id: string): Promise<Profile | null> {
    const result = await this.pool.query<Row>(
      `select ${SELECT_COLUMNS} from profiles where id = $1`,
      [id],
    );
    return result.rows[0] ? toProfile(result.rows[0]) : null;
  }

  async findLatestByOwner(ownerEmail: string): Promise<Profile | null> {
    const result = await this.pool.query<Row>(
      `select ${SELECT_COLUMNS} from profiles
       where owner_email = $1
       order by updated_at desc
       limit 1`,
      [ownerEmail],
    );
    return result.rows[0] ? toProfile(result.rows[0]) : null;
  }

  async listLatest(): Promise<Profile[]> {
    const result = await this.pool.query<Row>(
      `select ${SELECT_COLUMNS} from (
         select distinct on (owner_email) ${SELECT_COLUMNS}
         from profiles
         where owner_email is not null
         order by owner_email, updated_at desc
       ) as latest
       order by updated_at desc`,
    );
    return result.rows.map(toProfile);
  }

  async update(id: string, patch: NewProfileInput): Promise<Profile | null> {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [];

    params.push(patch.title);
    sets.push(`title = $${params.length}`);

    params.push(JSON.stringify(patch.answers));
    sets.push(`answers = $${params.length}::jsonb`);

    params.push(JSON.stringify(patch.weights));
    sets.push(`weights = $${params.length}::jsonb`);

    params.push(patch.source);
    sets.push(`source = $${params.length}`);

    params.push(patch.ownerEmail);
    sets.push(`owner_email = $${params.length}`);

    params.push(id);

    const result = await this.pool.query<Row>(
      `update profiles set ${sets.join(', ')}
       where id = $${params.length}
       returning ${SELECT_COLUMNS}`,
      params,
    );
    return result.rows[0] ? toProfile(result.rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.pool.query('delete from profiles where id = $1', [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }
}