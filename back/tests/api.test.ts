import type { FastifyInstance, InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/session.js';
import type { AuthConfig } from '../src/config.js';
import { MemoryProfileRepository } from './memory-repo.js';

const RULES = { qualityCount: 24, baseWeight: 50 };
const VALID_WEIGHTS = Array.from({ length: 24 }, () => 50);

/** Вход нужен всем маршрутам профилей — берём готовый токен без сети. */
const TEST_AUTH: AuthConfig = {
  mode: 'mock',
  secret: 'секрет-для-тестов-api',
  secretEphemeral: false,
  frontOrigin: 'http://localhost:4200',
  apiPublicOrigin: 'http://127.0.0.1:3000',
  google: null,
  adminEmail: 'admin@example.com',
  tokenTtlSeconds: 3600,
};

const TEST_EMAIL = 'owner@example.com';
const TEST_TOKEN = signToken(
  { kind: 'session', email: TEST_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 },
  TEST_AUTH.secret,
);

const ADMIN_TOKEN = signToken(
  { kind: 'session', email: TEST_AUTH.adminEmail, exp: Math.floor(Date.now() / 1000) + 3600 },
  TEST_AUTH.secret,
);

const STRANGER_TOKEN = signToken(
  { kind: 'session', email: 'stranger@example.com', exp: Math.floor(Date.now() / 1000) + 3600 },
  TEST_AUTH.secret,
);

async function makeApp() {
  const repo = new MemoryProfileRepository();
  const app = await buildApp({ repo, rules: RULES, auth: TEST_AUTH });
  return { app, repo };
}

/** Запрос от вошедшего пользователя; headers запроса главнее токена. */
function call(app: FastifyInstance, options: InjectOptions) {
  return app.inject({
    ...options,
    headers: { authorization: `Bearer ${TEST_TOKEN}`, ...(options.headers ?? {}) },
  });
}

describe('GET /api/health', () => {
  it('отвечает 200, когда база отвечает', async () => {
    const { app } = await makeApp();
    const response = await call(app, { method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: true });
    await app.close();
  });

  it('отвечает 503, когда база недоступна', async () => {
    const { app, repo } = await makeApp();
    repo.setHealthy(false);
    const response = await call(app, { method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', db: false });
    await app.close();
  });
});

describe('POST /api/profiles', () => {
  it('создаёт профиль и возвращает его с id', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: {
        title: 'Мой профиль',
        answers: { '1': 4, '2': 2 },
        weights: VALID_WEIGHTS,
        source: 'survey',
      },
    });

    expect(response.statusCode).toBe(201);
    const profile = response.json();
    expect(profile.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(profile.title).toBe('Мой профиль');
    expect(profile.answers).toEqual({ '1': 4, '2': 2 });
    expect(profile.weights).toHaveLength(24);
    expect(profile.source).toBe('survey');
    expect(profile.createdAt).toBe(profile.updatedAt);
    await app.close();
  });

  it('подставляет значения по умолчанию', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    expect(response.statusCode).toBe(201);
    const profile = response.json();
    expect(profile.title).toBeNull();
    expect(profile.answers).toEqual({});
    expect(profile.source).toBe('uniform');
    await app.close();
  });

  it('отклоняет суммы вне пула', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS.map((w, i) => (i === 0 ? w + 1 : w)) },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('Некорректный профиль');
    expect(body.issues).toContain('Сумма весов должна быть 1200');
    await app.close();
  });

  it('отклоняет не 24 качества', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: [50, 50, 50] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toContain('Ожидалось 24 качеств');
    await app.close();
  });

  it('отклоняет ответы вне шкалы 1…5', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { answers: { '7': 9 }, weights: VALID_WEIGHTS },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /api/profiles/:id', () => {
  it('возвращает сохранённый профиль', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    const response = await call(app, {
      method: 'GET',
      url: `/api/profiles/${created.json().id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().weights).toEqual(VALID_WEIGHTS);
    await app.close();
  });

  it('отвечает 404 для неизвестного id', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'GET',
      url: '/api/profiles/2b0f4a58-0e3c-4f5e-9f5a-1d8a3c9e7b21',
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('отвечает 400 для мусора вместо id', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'GET',
      url: '/api/profiles/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('PATCH /api/profiles/:id', () => {
  it('обновляет веса и переносит остальные поля', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { answers: { '1': 3 }, weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const nextWeights = VALID_WEIGHTS.map((w, i) => (i === 0 ? 100 : w - (100 - 50) / 23));
    const rounded = nextWeights.map((w) => Math.round(w));
    // приводим к точной сумме 1200, как это делает движок фронта
    rounded[1] += 1200 - rounded.reduce((a, b) => a + b, 0);

    const response = await call(app, {
      method: 'PATCH',
      url: `/api/profiles/${id}`,
      payload: { weights: rounded, source: 'calibrated' },
    });

    expect(response.statusCode).toBe(200);
    const profile = response.json();
    expect(profile.weights).toEqual(rounded);
    expect(profile.source).toBe('calibrated');
    expect(profile.answers).toEqual({ '1': 3 });
    await app.close();
  });

  it('отклоняет обновление, ломающее инварианты', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    const response = await call(app, {
      method: 'PATCH',
      url: `/api/profiles/${created.json().id}`,
      payload: { weights: VALID_WEIGHTS.slice(0, 23) },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('отвечает 404 для неизвестного id', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'PATCH',
      url: '/api/profiles/2b0f4a58-0e3c-4f5e-9f5a-1d8a3c9e7b21',
      payload: { title: 'x' },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /api/profiles/:id', () => {
  it('удаляет профиль и больше его не отдаёт', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const removed = await call(app, { method: 'DELETE', url: `/api/profiles/${id}` });
    expect(removed.statusCode).toBe(204);

    const again = await call(app, { method: 'GET', url: `/api/profiles/${id}` });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it('отвечает 404, когда профиля уже нет', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'DELETE',
      url: '/api/profiles/2b0f4a58-0e3c-4f5e-9f5a-1d8a3c9e7b21',
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('принимает DELETE с content-type json и пустым телом', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const response = await call(app, {
      method: 'DELETE',
      url: `/api/profiles/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });
});

describe('GET /api/admin/profiles', () => {
  it('отдаёт администратору по одному последнему профилю на почту', async () => {
    const { app, repo } = await makeApp();
    await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { answers: { '1': 4 }, weights: VALID_WEIGHTS },
    });
    // Второй профиль той же почты в список не дублируется.
    await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { answers: { '1': 5 }, weights: VALID_WEIGHTS },
    });
    await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { authorization: `Bearer ${STRANGER_TOKEN}` },
      payload: { weights: VALID_WEIGHTS },
    });
    // Профиль без владельца (наследие версии без входа) в админ-список не входит.
    await repo.create({
      title: null,
      answers: {},
      weights: VALID_WEIGHTS,
      source: 'uniform',
      ownerEmail: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/profiles',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const profiles = response.json();
    expect(profiles).toHaveLength(2);
    expect(profiles.map((p: { ownerEmail: string }) => p.ownerEmail)).toEqual(
      expect.arrayContaining([TEST_EMAIL, 'stranger@example.com']),
    );
    expect(profiles[0].answers).toBeDefined();
    await app.close();
  });

  it('не пускает обычного пользователя и анонима', async () => {
    const { app } = await makeApp();
    const asOwner = await call(app, { method: 'GET', url: '/api/admin/profiles' });
    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/profiles' });

    expect(asOwner.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });
});

describe('вход обязателен', () => {
  it('без токена профили не создаются', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('без токена профиль не читается', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/profiles/${created.json().id}`,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('тела запросов', () => {
  it('отклоняет битый JSON', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      headers: { 'content-type': 'application/json' },
      payload: '{не json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('JSON');
    await app.close();
  });

  it('пропускает запрос без тела', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/profiles',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Некорректный профиль');
    await app.close();
  });
});