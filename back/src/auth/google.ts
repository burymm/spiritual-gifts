import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * Клиентская часть Google OAuth: ссылка согласия, обмен code на токен и
 * проверка ID-токена (подпись RS256 по ключам Google, аудитория и срок).
 * Проверка нужна: без неё достаточно было бы подделать JSON в id_token.
 */

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CERTS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';

export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface GoogleProfile {
  readonly email: string;
  readonly sub: string;
}

/** Строка согласия Google: на неё делаем обычный редирект браузера. */
export function buildAuthorizeUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', options.state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Меняет authorization code на ID-токен. Сеть обязательна — без неё входа нет. */
export async function exchangeCode(options: {
  readonly code: string;
  readonly credentials: GoogleCredentials;
  readonly redirectUri: string;
}): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.credentials.clientId,
      client_secret: options.credentials.clientSecret,
      code: options.code,
      grant_type: 'authorization_code',
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google не обменял код на токен (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string' || body.id_token === '') {
    throw new Error('В ответе Google нет id_token');
  }
  return body.id_token;
}

interface CachedKeys {
  readonly keys: ReadonlyMap<string, KeyObject>;
  readonly expiresAt: number;
}

let cached: CachedKeys | null = null;

function decodeJson(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Некорректный JSON внутри ID-токена');
  }
  return parsed as Record<string, unknown>;
}

async function signingKeys(): Promise<ReadonlyMap<string, KeyObject>> {
  if (cached !== null && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(CERTS_ENDPOINT);
  if (!response.ok) throw new Error(`Не удалось получить ключи Google (HTTP ${response.status})`);

  // Google сам указывает срок жизни кэша; запасной вариант — 10 минут.
  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAge = /max-age=(\d+)/i.exec(cacheControl);
  const ttl = maxAge !== null ? Number(maxAge[1]) : 600;

  const body = (await response.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    const kid = typeof jwk.kid === 'string' ? jwk.kid : '';
    if (kid === '' || jwk.kty !== 'RSA') continue;
    keys.set(kid, createPublicKey({ key: jwk as never, format: 'jwk' }));
  }
  if (keys.size === 0) throw new Error('Google вернул пустой набор ключей');

  cached = { keys, expiresAt: Date.now() + Math.max(60, ttl) * 1000 };
  return keys;
}

/** Проверяет ID-токен Google и возвращает почту; любая ошибка — вход отклонён. */
export async function verifyIdToken(
  idToken: string,
  clientId: string,
): Promise<GoogleProfile> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('ID-токен Google имеет неверный формат');

  const header = decodeJson(parts[0]);
  if (header.alg !== 'RS256') throw new Error(`Неожиданный алгоритм подписи: ${String(header.alg)}`);

  const keys = await signingKeys();
  const kid = typeof header.kid === 'string' ? header.kid : '';
  const key = keys.get(kid);
  if (key === undefined) throw new Error('Среди ключей Google нет ключа этого токена');

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const signature = Buffer.from(parts[2], 'base64url');
  if (!verifySignature('RSA-SHA256', signed, key, signature)) {
    throw new Error('Подпись ID-токена не сошлась');
  }

  const payload = decodeJson(parts[1]);

  const audience = payload.aud;
  const audMatches =
    audience === clientId ||
    (Array.isArray(audience) && audience.includes(clientId));
  if (!audMatches) throw new Error('ID-токен выдан для другого приложения');

  const expiresAt = payload.exp;
  if (typeof expiresAt !== 'number' || expiresAt * 1000 <= Date.now()) {
    throw new Error('ID-токен Google просрочен');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (email === '') throw new Error('В ответе Google нет почты');
  if (payload.email_verified === false) {
    throw new Error('Почта в Google не подтверждена');
  }

  return { email, sub: typeof payload.sub === 'string' ? payload.sub : '' };
}
