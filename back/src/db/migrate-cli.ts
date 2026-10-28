import { Pool } from 'pg';

import { loadDatabaseUrl, loadEnvFile } from '../config.js';
import { runMigrations } from './migrate.js';

// Миграциям нужна только строка подключения — ни порт, ни origin не участвуют.
loadEnvFile();
const pool = new Pool({ connectionString: loadDatabaseUrl() });

try {
  const applied = await runMigrations(pool);
  console.log(
    applied.length > 0
      ? `Применено миграций: ${applied.join(', ')}`
      : 'База уже обновлена, новых миграций нет.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}