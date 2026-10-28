import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/** back/migrations — и из src/db, и из dist/db путь одинаковый по глубине. */
const MIGRATIONS_DIR = path.resolve(
  fileURLToPath(new URL('../../migrations', import.meta.url)),
);

const CREATE_TRACKER = `create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Применяет недостающие SQL-миграции по порядку имён, каждую в своей
 * транзакции. Повторный запуск ничего не ломает — уже применённые пропускаются.
 * Возвращает имена применённых файлов.
 */
export async function runMigrations(
  pool: Pool,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(CREATE_TRACKER);

    const files = (await readdir(dir))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    const applied: string[] = [];
    for (const file of files) {
      const done = await client.query(
        'select 1 from schema_migrations where name = $1',
        [file],
      );
      if ((done.rowCount ?? 0) > 0) continue;

      const sql = await readFile(path.join(dir, file), 'utf8');

      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [
          file,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Миграция ${file} не применилась: ${message(error)}`);
      }

      applied.push(file);
    }

    return applied;
  } finally {
    client.release();
  }
}