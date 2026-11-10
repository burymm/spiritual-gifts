import type { Pool } from 'pg';

import type { Pastor } from '../domain/pastor.js';
import type { AssignPastorResult, PastorRepository } from './types.js';

interface Row {
  email: string;
  assigned_at: Date | string;
  assigned_by: string | null;
}

const COLUMNS = 'email, assigned_at, assigned_by';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toPastor(row: Row): Pastor {
  return {
    email: row.email,
    assignedAt: iso(row.assigned_at),
    assignedBy: row.assigned_by,
  };
}

/**
 * Пасторы в Postgres. Почта — первичный ключ: `on conflict do nothing` делает
 * назначение идемпотентным, а второй запрос добирает уже существующую запись,
 * чтобы ответ был одинаковым и при повторе.
 */
export class PostgresPastorRepository implements PastorRepository {
  constructor(private readonly pool: Pool) {}

  async find(email: string): Promise<Pastor | null> {
    const result = await this.pool.query<Row>(
      `select ${COLUMNS} from pastors where email = $1`,
      [email],
    );
    return result.rows[0] ? toPastor(result.rows[0]) : null;
  }

  async list(): Promise<Pastor[]> {
    const result = await this.pool.query<Row>(
      `select ${COLUMNS} from pastors order by assigned_at desc, email`,
    );
    return result.rows.map(toPastor);
  }

  async assign(email: string, assignedBy: string): Promise<AssignPastorResult> {
    const inserted = await this.pool.query<Row>(
      `insert into pastors (email, assigned_by)
       values ($1, $2)
       on conflict (email) do nothing
       returning ${COLUMNS}`,
      [email, assignedBy],
    );
    if (inserted.rows[0] !== undefined) {
      return { pastor: toPastor(inserted.rows[0]), created: true };
    }

    const existing = await this.pool.query<Row>(
      `select ${COLUMNS} from pastors where email = $1`,
      [email],
    );
    if (existing.rows[0] === undefined) {
      throw new Error(`Пастор ${email} не назначен и не найден`);
    }
    return { pastor: toPastor(existing.rows[0]), created: false };
  }

  async remove(email: string): Promise<boolean> {
    const result = await this.pool.query(
      'delete from pastors where email = $1',
      [email],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
