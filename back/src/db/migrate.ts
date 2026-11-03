import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/**
 * Каталог миграций зависит от того, как запущен код: из src/db и dist/db —
 * ../../migrations, а на Vercel handler лежит в бандле back/src/server.mjs,
 * поэтому перебираем кандидатов и берём первый существующий.
 */
function resolveMigrationsDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [
    path.resolve(here, '../../migrations'), // src/db и dist/db → back/migrations
    path.resolve(here, '../migrations'), // бандл back/src → back/migrations
    path.resolve(here, '../../back/migrations'),
    path.resolve(process.cwd(), 'back/migrations'),
    path.resolve(process.cwd(), 'migrations'),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (found === undefined) {
    throw new Error(
      `Каталог миграций не найден, искали: ${candidates.join(', ')}`,
    );
  }
  return found;
}

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
  dir: string = resolveMigrationsDir(),
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