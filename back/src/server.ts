import { Pool } from 'pg';

import { buildApp, findStaticDir } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import type { Config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { PostgresProfileRepository } from './repo/postgres.js';

function fail(message: string): never {
  console.error(`\n[api] ${message}\n`);
  process.exit(1);
}

console.log('[api] старт процесса', new Date().toISOString());

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}
console.log('[api] конфиг загружен');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  // Supabase session pooler закрывает незанятые соединения сам.
  idleTimeoutMillis: 30_000,
  // Без таймаута зависший TCP-коннект из серверлеса молча висел бы вечно.
  connectionTimeoutMillis: 10_000,
});
pool.on('error', (error) =>
  console.error('[api] ошибка пула Postgres:', error.message),
);

/**
 * Весь старт (миграции → сборка приложения → listen) выполняется внутри
 * async main(). Top-level await в entrypoint на Vercel приводит к тому,
 * что функция висит до 60-секундного таймаута и умирает без логов.
 */
async function main(): Promise<void> {
  console.log('[api] подключение к базе и миграции…');
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length > 0
        ? `[api] применено миграций: ${applied.join(', ')}`
        : '[api] миграции уже применены',
    );
  } catch (error) {
    fail(`миграции не применились: ${error instanceof Error ? error.message : error}`);
  }

  const staticDir = findStaticDir();
  console.log(
    staticDir === null
      ? '[api] public/ не найден — раздаём только API'
      : `[api] статика фронта: ${staticDir}`,
  );

  const app = await buildApp({
    repo: new PostgresProfileRepository(pool),
    rules: { qualityCount: config.qualityCount, baseWeight: config.baseWeight },
    corsOrigin: config.corsOrigin,
    auth: config.auth,
    logger: true,
    staticDir: staticDir ?? undefined,
  });

  if (config.auth.secretEphemeral) {
    console.warn(
      '[api] SESSION_SECRET не задан — токены подписаны случайным секретом: после рестарта все входы слетят. Для постоянности добавьте SESSION_SECRET в back/.env',
    );
  }
  console.log(
    `[api] вход: ${config.auth.mode === 'google' ? 'Google OAuth' : 'эмуляция входа (mock)'}`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[api] ${signal}, останавливаюсь…`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(
      `[api] профили: http://localhost:${config.port}/api/profiles · пул ${config.baseWeight}×${config.qualityCount}`,
    );
  } catch (error) {
    fail(`не удалось запустить сервер: ${error instanceof Error ? error.message : error}`);
  }
}

void main().catch((error) =>
  fail(`ошибка старта: ${error instanceof Error ? error.message : error}`),
);