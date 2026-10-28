import path from 'node:path';

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly corsOrigin: string;
  readonly qualityCount: number;
  readonly baseWeight: number;
}

export class ConfigError extends Error {}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${key} должен быть целым числом, получено: ${raw}`);
  }
  return value;
}

/** Читает .env рядом с корнем back/, если файла нет — молчит. */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), '.env'));
  } catch {
    // Файла .env может не быть — работаем из окружения.
  }
}

/**
 * Supabase держит TLS на собственном корневом сертификате ("Supabase Root 2021 CA"),
 * которого нет в системном хранилище, — стандартная проверка цепочки падает
 * с SELF_SIGNED_CERT_IN_CHAIN. Для хостов Supabase включаем TLS без проверки
 * цепочки (трафик всё равно зашифрован). Свой CA можно дать через sslrootcert=,
 * тогда его мы не трогаем.
 */
function normalizeSupabaseSsl(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }
  if (!/\.supabase\.(com|co|in)$/i.test(url.hostname)) return databaseUrl;
  if (url.searchParams.has('sslrootcert')) return databaseUrl;
  if (url.searchParams.get('sslmode') === 'no-verify') return databaseUrl;
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

/** Строка подключения к базе; её же используют отдельные команды (миграции). */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  if (databaseUrl === '') {
    throw new ConfigError(
      'Не задан DATABASE_URL. Скопируйте back/.env.example в back/.env и вставьте ' +
        'строку подключения Supabase (Dashboard → Connect → Session pooler).',
    );
  }
  if (!/^(postgres|postgresql):\/\//.test(databaseUrl)) {
    if (/\.supabase\.(com|co|in)\b/i.test(databaseUrl)) {
      throw new ConfigError(
        'DATABASE_URL похож на URL из Supabase → Settings → API (https://<ref>.supabase.co/rest/v1/) — ' +
          'это REST API, а не база. Нужна строка подключения Postgres: Dashboard → Connect → ' +
          'Session pooler → URI (вида postgresql://postgres.<ref>:...@aws-0-eu-west-1.pooler.supabase.com:5432/postgres).',
      );
    }
    throw new ConfigError('DATABASE_URL должен начинаться с postgres:// или postgresql://');
  }
  return normalizeSupabaseSsl(databaseUrl);
}

/**
 * Собирает конфигурацию сервера. Падает с понятной ошибкой, когда обязательной
 * переменной нет: лучше упасть при старте, чем молча писать не туда.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  loadEnvFile();

  return {
    port: int(env, 'PORT', 3000),
    databaseUrl: loadDatabaseUrl(env),
    corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:4200').trim(),
    qualityCount: int(env, 'QUALITY_COUNT', 24),
    baseWeight: int(env, 'BASE_WEIGHT', 50),
  };
}