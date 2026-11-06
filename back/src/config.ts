import { randomBytes } from 'node:crypto';
import path from 'node:path';

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly corsOrigin: string;
  readonly qualityCount: number;
  readonly baseWeight: number;
  readonly auth: AuthConfig;
}

export type AuthMode = 'google' | 'mock';

/** Почта администратора по умолчанию; переопределяется ADMIN_EMAIL. */
export const DEFAULT_ADMIN_EMAIL = 'burymm@gmail.com';

/**
 * Настройки входа. `google` — настоящий OAuth через Google; `mock` — эмуляция
 * входа для локальной сборки, когда ключей Google нет: пользователь просто
 * вводит почту и получает такой же подписанный токен.
 */
export interface AuthConfig {
  readonly mode: AuthMode;
  /** Секрет подписи токенов; если в окружении его нет — случайный на каждый запуск. */
  readonly secret: string;
  /** true — секрет сгенерирован на старте, старые сессии умрут после рестарта. */
  readonly secretEphemeral: boolean;
  /** Единственный разрешённый origin фронта (куда возвращаемся после входа). */
  readonly frontOrigin: string;
  /** Публичный адрес самого API — из него собирается redirect_uri Google. */
  readonly apiPublicOrigin: string;
  readonly google: { readonly clientId: string; readonly clientSecret: string } | null;
  /** Единственная почта с доступом к списку всех результатов. */
  readonly adminEmail: string;
  readonly tokenTtlSeconds: number;
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

function origin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** Почта как её отдаёт Google: lowercase, без пробелов по краям. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Режим входа: AUTH_MODE задаёт явно; иначе — Google, если заполнены оба
 * ключа GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, иначе эмуляция (mock),
 * чтобы локальная разработка работала без настройки OAuth-консольи.
 */
export function loadAuthConfig(
  env: NodeJS.ProcessEnv,
  apiPublicOrigin: string,
  frontOrigin: string,
): AuthConfig {
  const googleClientId = (env.GOOGLE_CLIENT_ID ?? '').trim();
  const googleClientSecret = (env.GOOGLE_CLIENT_SECRET ?? '').trim();
  const google =
    googleClientId !== '' && googleClientSecret !== ''
      ? { clientId: googleClientId, clientSecret: googleClientSecret }
      : null;

  const rawMode = (env.AUTH_MODE ?? '').trim().toLowerCase();
  if (rawMode !== '' && rawMode !== 'google' && rawMode !== 'mock') {
    throw new ConfigError(`AUTH_MODE должен быть google или mock, получено: ${rawMode}`);
  }
  const mode: AuthMode = rawMode !== '' ? (rawMode as AuthMode) : google !== null ? 'google' : 'mock';

  if (mode === 'google' && google === null) {
    throw new ConfigError(
      'AUTH_MODE=google, но не заданы GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET. ' +
        'Заполните обе переменные в back/.env или оставьте AUTH_MODE=mock для эмуляции входа.',
    );
  }

  const secret = (env.SESSION_SECRET ?? '').trim();
  const adminEmail = (env.ADMIN_EMAIL ?? '').trim() || DEFAULT_ADMIN_EMAIL;
  return {
    mode,
    secret: secret !== '' ? secret : randomBytes(32).toString('hex'),
    secretEphemeral: secret === '',
    frontOrigin: origin(frontOrigin),
    apiPublicOrigin: origin(apiPublicOrigin),
    google,
    adminEmail: normalizeEmail(adminEmail),
    tokenTtlSeconds: int(env, 'SESSION_TTL_HOURS', 720) * 3600,
  };
}

/**
 * Собирает конфигурацию сервера. Падает с понятной ошибкой, когда обязательной
 * переменной нет: лучше упасть при старте, чем молча писать не туда.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  loadEnvFile();

  const port = int(env, 'PORT', 3000);
  const frontOrigin = (env.FRONT_ORIGIN ?? 'http://localhost:4200').trim();
  const apiPublicOrigin = (env.API_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`).trim();

  return {
    port,
    databaseUrl: loadDatabaseUrl(env),
    corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:4200').trim(),
    qualityCount: int(env, 'QUALITY_COUNT', 24),
    baseWeight: int(env, 'BASE_WEIGHT', 50),
    auth: loadAuthConfig(env, apiPublicOrigin, frontOrigin),
  };
}