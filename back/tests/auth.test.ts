import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { signToken, verifySession, verifyState } from '../src/auth/session.js';
import { buildAuthorizeUrl } from '../src/auth/google.js';
import { ConfigError, loadAuthConfig, type AuthConfig } from '../src/config.js';
import { MemoryProfileRepository } from './memory-repo.js';

const RULES = { qualityCount: 24, baseWeight: 50 };
const VALID_WEIGHTS = Array.from({ length: 24 }, () => 50);

/** Эмуляция входа — тот же формат токена, что у настоящего Google. */
const MOCK_AUTH: AuthConfig = {
  mode: 'mock',
  secret: 'секрет-для-тестов',
  secretEphemeral: false,
  frontOrigin: 'http://localhost:4200',
  apiPublicOrigin: 'http://127.0.0.1:3000',
  google: null,
  adminEmail: 'admin@example.com',
  tokenTtlSeconds: 3600,
};

const GOOGLE_AUTH: AuthConfig = {
  ...MOCK_AUTH,
  mode: 'google',
  google: { clientId: 'client-id.apps.googleusercontent.com', clientSecret: 'secret' },
};

async function makeApp(auth: AuthConfig = MOCK_AUTH) {
  const repo = new MemoryProfileRepository();
  const app = await buildApp({ repo, rules: RULES, auth });
  return { app, repo };
}

/** «Вход» в тестах: токен из эмуляции, без сети. */
async function signIn(app: Awaited<ReturnType<typeof makeApp>>['app'], email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/mock',
    payload: { email },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { token: string; email: string; admin: boolean };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('подписанные токены', () => {
  it('возвращает почту из свежей сессии', () => {
    const token = signToken(
      { kind: 'session', email: 'a@b.co', exp: Math.floor(Date.now() / 1000) + 60 },
      'секрет',
    );
    expect(verifySession(token, 'секрет')).toBe('a@b.co');
  });

  it('отклоняет чужой секрет и подделанный payload', () => {
    const token = signToken(
      { kind: 'session', email: 'a@b.co', exp: Math.floor(Date.now() / 1000) + 60 },
      'секрет',
    );
    const [prefix, body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ kind: 'session', email: 'thief@b.co', exp: 9999999999 }),
      'utf8',
    ).toString('base64url');

    expect(verifySession(token, 'другой-секрет')).toBeNull();
    expect(verifySession(`${prefix}.${forged}.${sig}`, 'секрет')).toBeNull();
    expect(verifySession(`${prefix}.${forged}`, 'секрет')).toBeNull();
  });

  it('отклоняет истёкшую сессию', () => {
    const token = signToken(
      { kind: 'session', email: 'a@b.co', exp: Math.floor(Date.now() / 1000) - 1 },
      'секрет',
    );
    expect(verifySession(token, 'секрет')).toBeNull();
  });

  it('не пускает токен состояния вместо сессии', () => {
    const state = signToken(
      { kind: 'state', origin: 'http://localhost:4200', exp: Math.floor(Date.now() / 1000) + 600 },
      'секрет',
    );
    expect(verifySession(state, 'секрет')).toBeNull();
    expect(verifyState(state, 'секрет')).toBe('http://localhost:4200');
    expect(verifyState('бито', 'секрет')).toBeNull();
  });
});

describe('конфигурация входа', () => {
  it('без ключей Google включает эмуляцию входа', () => {
    const auth = loadAuthConfig({}, 'http://127.0.0.1:3000', 'http://localhost:4200');
    expect(auth.mode).toBe('mock');
    expect(auth.google).toBeNull();
    expect(auth.secret).not.toBe('');
    expect(auth.secretEphemeral).toBe(true);
  });

  it('переключается на Google, когда заполнены оба ключа', () => {
    const auth = loadAuthConfig(
      { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'shh', SESSION_SECRET: 'стойкий' },
      'http://127.0.0.1:3000',
      'http://localhost:4200',
    );
    expect(auth.mode).toBe('google');
    expect(auth.secretEphemeral).toBe(false);
    expect(auth.google?.clientId).toBe('id');
  });

  it('назначает администратора по умолчанию и разрешает переопределить', () => {
    expect(
      loadAuthConfig({}, 'http://127.0.0.1:3000', 'http://localhost:4200').adminEmail,
    ).toBe('burymm@gmail.com');
    expect(
      loadAuthConfig(
        { ADMIN_EMAIL: ' Boss@Example.com ' },
        'http://127.0.0.1:3000',
        'http://localhost:4200',
      ).adminEmail,
    ).toBe('boss@example.com');
  });

  it('падает с понятной ошибкой при AUTH_MODE=google без ключей', () => {
    expect(() =>
      loadAuthConfig({ AUTH_MODE: 'google' }, 'http://127.0.0.1:3000', 'http://localhost:4200'),
    ).toThrow(ConfigError);
  });
});

describe('GET /api/auth/config', () => {
  it('отдаёт режим входа', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: 'mock' });
    await app.close();
  });
});

describe('эмуляция входа', () => {
  it('выдаёт токен и отвечает на /me', async () => {
    const { app } = await makeApp();
    const { token, email } = await signIn(app, 'Reader@Example.com');

    expect(email).toBe('reader@example.com');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ email: 'reader@example.com', admin: false });
    await app.close();
  });

  it('помечает администратора по почте', async () => {
    const { app } = await makeApp();
    const { token, admin } = await signIn(app, 'admin@example.com');

    expect(admin).toBe(true);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect(me.json()).toEqual({ email: 'admin@example.com', admin: true });
    await app.close();
  });

  it('отвечает 401 без токена и с мусором', async () => {
    const { app } = await makeApp();
    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/me' });
    const garbage = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: bearer('sg1.не.тот-токен'),
    });

    expect(anonymous.statusCode).toBe(401);
    expect(garbage.statusCode).toBe(401);
    await app.close();
  });

  it('отклоняет почту без @', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/mock',
      payload: { email: 'не-почта' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('выключен, когда настроен настоящий Google', async () => {
    const { app } = await makeApp(GOOGLE_AUTH);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/mock',
      payload: { email: 'a@b.co' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('редирект на Google', () => {
  it('собирает согласие с проверенным origin и state', async () => {
    const { app } = await makeApp(GOOGLE_AUTH);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/login?origin=http://localhost:4200',
    });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe(GOOGLE_AUTH.google?.clientId);
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3000/api/auth/callback',
    );
    expect(location.searchParams.get('state')).toBeTruthy();
    await app.close();
  });

  it('не возвращает пользователя на чужой origin', async () => {
    const { app } = await makeApp(GOOGLE_AUTH);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/login?origin=https://evil.example',
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('в режиме эмуляции входа ссылку не отдаёт', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/login?origin=http://localhost:4200',
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('callback с битым state уводит на фронт с ошибкой', async () => {
    const { app } = await makeApp(GOOGLE_AUTH);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=abc&state=подделано',
    });

    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain('http://localhost:4200/login?error=state');
    await app.close();
  });

  it('ссылка согласия содержит все параметры', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'id',
        redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
        state: 'подпись',
      }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('подпись');
  });
});

describe('владение профилем', () => {
  it('профиль создаётся на почту и отдаётся через /mine', async () => {
    const { app } = await makeApp();
    const { token } = await signIn(app, 'a@b.co');

    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: bearer(token),
      payload: { weights: VALID_WEIGHTS },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().ownerEmail).toBe('a@b.co');

    const mine = await app.inject({ method: 'GET', url: '/api/profiles/mine', headers: bearer(token) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().id).toBe(created.json().id);
    await app.close();
  });

  it('/mine без входа отвечает 401', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/profiles/mine' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('чужой не читает и не правит профиль по ссылке', async () => {
    const { app } = await makeApp();
    const owner = await signIn(app, 'owner@b.co');
    const stranger = await signIn(app, 'stranger@b.co');

    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: bearer(owner.token),
      payload: { weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const readAsStranger = await app.inject({
      method: 'GET',
      url: `/api/profiles/${id}`,
      headers: bearer(stranger.token),
    });
    const patchAsStranger = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${id}`,
      headers: bearer(stranger.token),
      payload: { title: 'свое' },
    });
    const deleteAsStranger = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${id}`,
      headers: bearer(stranger.token),
    });

    expect(readAsStranger.statusCode).toBe(404);
    expect(patchAsStranger.statusCode).toBe(404);
    expect(deleteAsStranger.statusCode).toBe(404);
    await app.close();
  });

  it('владелец читает свой профиль, чужак — нет', async () => {
    const { app } = await makeApp();
    const owner = await signIn(app, 'owner@b.co');
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: bearer(owner.token),
      payload: { weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const asOwner = await app.inject({
      method: 'GET',
      url: `/api/profiles/${id}`,
      headers: bearer(owner.token),
    });
    const anonymous = await app.inject({ method: 'GET', url: `/api/profiles/${id}` });

    expect(asOwner.statusCode).toBe(200);
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });

  it('профиль без входа «забирает» первый вошедший', async () => {
    const { app, repo } = await makeApp();
    // Такой профиль остался от версии без обязательного входа.
    const created = await repo.create({
      title: null,
      answers: { 1: 4 },
      weights: VALID_WEIGHTS,
      source: 'survey',
      ownerEmail: null,
    });
    const id = created.id;

    const { token } = await signIn(app, 'newcomer@b.co');
    const claimed = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${id}`,
      headers: bearer(token),
      payload: { title: 'мой' },
    });

    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().ownerEmail).toBe('newcomer@b.co');

    const mine = await app.inject({ method: 'GET', url: '/api/profiles/mine', headers: bearer(token) });
    expect(mine.json().id).toBe(id);

    // Старая ссылка-ключ больше ничего не отдаёт без входа
    const byOldLink = await app.inject({ method: 'GET', url: `/api/profiles/${id}` });
    expect(byOldLink.statusCode).toBe(401);
    await app.close();
  });

  it('анонимный PATCH отклоняется', async () => {
    const { app } = await makeApp();
    const owner = await signIn(app, 'owner@b.co');
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: bearer(owner.token),
      payload: { weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${id}`,
      payload: { title: 'без входа' },
    });

    expect(patched.statusCode).toBe(401);
    await app.close();
  });

  it('анонимные профили больше не создаются', async () => {
    const { app } = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    expect(created.statusCode).toBe(401);
    await app.close();
  });
});
