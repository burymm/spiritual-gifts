import { Pool } from 'pg';

import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { PostgresProfileRepository } from './repo/postgres.js';

function fail(message: string): never {
  console.error(`\n[api] ${message}\n`);
  process.exit(1);
}

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  // Supabase session pooler закрывает незанятые соединения сам.
  idleTimeoutMillis: 30_000,
});

try {
  const applied = await runMigrations(pool);
  if (applied.length > 0) {
    console.log(`[api] применено миграций: ${applied.join(', ')}`);
  }
} catch (error) {
  fail(`миграции не применились: ${error instanceof Error ? error.message : error}`);
}

const app = await buildApp({
  repo: new PostgresProfileRepository(pool),
  rules: { qualityCount: config.qualityCount, baseWeight: config.baseWeight },
  corsOrigin: config.corsOrigin,
  auth: config.auth,
  logger: true,
});

if (config.auth.secretEphemeral) {
  console.warn(
    '[api] SESSION_SECRET не задан — токены подписаны случайным секретом: после рестарта все входы слетят. Для постоянства добавьте SESSION_SECRET в back/.env',
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