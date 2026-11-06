import type { FastifyInstance, FastifyRequest } from 'fastify';

import { EMAIL_PATTERN, normalizeEmail, type AuthConfig } from '../config.js';
import { buildAuthorizeUrl, exchangeCode, verifyIdToken } from './google.js';
import { signToken, verifySession, verifyState } from './session.js';

/**
 * HTTP-часть входа. Токен живёт в localStorage фронта и приходит на каждый
 * запрос заголовком Authorization — так вход переживает отдельные origin'ы
 * (фронт на :4200, API на :3000) без кук и SameSite-головоломок.
 */

/** Администратор — только одна почта из конфигурации (ADMIN_EMAIL). */
export function isAdminEmail(email: string, auth: AuthConfig): boolean {
  return normalizeEmail(email) === auth.adminEmail;
}

/** Почта из заголовка Authorization: Bearer <token>, либо null. */
export function userOf(request: FastifyRequest, auth: AuthConfig): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  return verifySession(match[1].trim(), auth.secret);
}

/** Браузер после Google возвращается на фронт — код ошибки отдаём ему. */
function loginUrl(auth: AuthConfig, error: string): string {
  return `${auth.frontOrigin}/login?error=${encodeURIComponent(error)}`;
}

interface LoginQuery {
  origin?: string;
}

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthConfig): void {
  // Режим входа: фронт узнаёт, показывать ли кнопку Google или эмуляцию.
  app.get('/api/auth/config', async (_request, reply) => reply.send({ mode: auth.mode }));

  // Шаг 1: редирект на согласие Google. origin проверяем — назад можно
  // вернуться только на настроенный фронт, иначе токен ушёл бы чужому сайту.
  app.get<{ Querystring: LoginQuery }>('/api/auth/login', async (request, reply) => {
    if (auth.mode !== 'google' || auth.google === null) {
      return reply
        .code(400)
        .send({ error: 'Вход через Google выключен — используется эмуляция входа (POST /api/auth/mock)' });
    }

    const origin = (request.query.origin ?? '').trim().replace(/\/+$/, '');
    if (origin !== auth.frontOrigin) {
      return reply
        .code(400)
        .send({ error: `Неизвестный origin: ${origin || '(пусто)'}. Ожидался ${auth.frontOrigin}` });
    }

    const state = signToken(
      { kind: 'state', origin, exp: Math.floor(Date.now() / 1000) + 600 },
      auth.secret,
    );
    const url = buildAuthorizeUrl({
      clientId: auth.google.clientId,
      redirectUri: `${auth.apiPublicOrigin}/api/auth/callback`,
      state,
    });
    return reply.redirect(url, 302);
  });

  // Шаг 2: Google возвращает сюда с code — меняем на сессию и уводим на фронт.
  app.get<{ Querystring: CallbackQuery }>('/api/auth/callback', async (request, reply) => {
    const { code, state, error } = request.query;

    if (error !== undefined && error !== '') {
      request.log.info({ provider_error: error }, 'Google отклонил вход');
      return reply.redirect(loginUrl(auth, 'denied'), 302);
    }
    if (code === undefined || state === undefined) {
      return reply.redirect(loginUrl(auth, 'state'), 302);
    }
    const origin = verifyState(state, auth.secret);
    if (origin === null || origin !== auth.frontOrigin || auth.google === null) {
      return reply.redirect(loginUrl(auth, 'state'), 302);
    }

    try {
      const idToken = await exchangeCode({
        code,
        credentials: auth.google,
        redirectUri: `${auth.apiPublicOrigin}/api/auth/callback`,
      });
      const profile = await verifyIdToken(idToken, auth.google.clientId);

      const token = signToken(
        {
          kind: 'session',
          email: profile.email,
          exp: Math.floor(Date.now() / 1000) + auth.tokenTtlSeconds,
        },
        auth.secret,
      );
      return reply.redirect(`${origin}/auth/callback#token=${encodeURIComponent(token)}`, 302);
    } catch (cause) {
      request.log.error({ err: cause }, 'вход через Google не удался');
      return reply.redirect(loginUrl(auth, 'exchange'), 302);
    }
  });

  // Эмуляция входа для локальной сборки: токен подписывается тем же секретом,
  // что и настоящий, — дальше поведение полностью совпадает.
  app.post<{ Body: { email?: unknown } }>('/api/auth/mock', async (request, reply) => {
    if (auth.mode !== 'mock') {
      return reply.code(403).send({ error: 'Эмуляция входа выключена: настроен настоящий Google OAuth' });
    }

    const email = normalizeEmail(typeof request.body?.email === 'string' ? request.body.email : '');
    if (!EMAIL_PATTERN.test(email)) {
      return reply.code(400).send({ error: 'Нужен корректный адрес почты' });
    }

    const token = signToken(
      { kind: 'session', email, exp: Math.floor(Date.now() / 1000) + auth.tokenTtlSeconds },
      auth.secret,
    );
    return reply.code(201).send({ token, email, admin: isAdminEmail(email, auth) });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) return reply.code(401).send({ error: 'Вход не выполнен' });
    return reply.send({ email, admin: isAdminEmail(email, auth) });
  });

  // Токен хранится на клиенте, поэтому выход — просто его выбросить;
  // 204 подтверждает, что сервер согласен.
  app.post('/api/auth/logout', async (_request, reply) => reply.code(204).send());
}
