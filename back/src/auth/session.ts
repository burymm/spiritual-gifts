import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Подписанные токены формата `sg1.<payload>.<sig>` (HMAC-SHA256).
 * Ключевые свойства: токен самодостаточен (не нужна таблица сессий) и
 * неверифицируем без секрета, поэтому бэкенд не хранит состояние входа.
 *
 * Payload несёт `kind`, чтобы токен состояния входа (state) нельзя было
 * подставить вместо пользовательской сессии и наоборот.
 */

export type TokenKind = 'session' | 'state';

export interface SessionPayload {
  readonly kind: 'session';
  readonly email: string;
  /** Unix-время в секундах. */
  readonly exp: number;
}

export interface StatePayload {
  readonly kind: 'state';
  /** Куда вернуть пользователя после Google: origin фронта. */
  readonly origin: string;
  readonly exp: number;
}

const PREFIX = 'sg1';

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Подписывает объект; JSON-поля терпимы к порядку — подпись от сериализации. */
export function signToken(payload: SessionPayload | StatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const data = `${PREFIX}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

function verifyToken(token: string, secret: string, kind: TokenKind): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;

  const data = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(data, secret));
  const actual = Buffer.from(parts[2]);
  // Сравниваем только после проверки длины — иначе timingSafeEqual бросает.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const payload = parsed as Record<string, unknown>;
  if (payload.kind !== kind) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  return payload;
}

/** Почта владельца сессии или null, если токен чужой, битый или истёк. */
export function verifySession(token: string, secret: string): string | null {
  const payload = verifyToken(token, secret, 'session');
  const email = payload?.email;
  if (typeof email !== 'string' || email.trim() === '') return null;
  return email;
}

/** Origin, ради которого открыт вход, или null для чужого/просроченного state. */
export function verifyState(token: string, secret: string): string | null {
  const payload = verifyToken(token, secret, 'state');
  const origin = payload?.origin;
  return typeof origin === 'string' && origin !== '' ? origin : null;
}
