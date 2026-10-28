import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { MemoryProfileRepository } from './memory-repo.js';

const RULES = { qualityCount: 24, baseWeight: 50 };
const VALID_WEIGHTS = Array.from({ length: 24 }, () => 50);

async function makeApp() {
  const repo = new MemoryProfileRepository();
  const app = await buildApp({ repo, rules: RULES });
  return { app, repo };
}

describe('GET /api/health', () => {
  it('отвечает 200, когда база отвечает', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: true });
    await app.close();
  });

  it('отвечает 503, когда база недоступна', async () => {
    const { app, repo } = await makeApp();
    repo.setHealthy(false);
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', db: false });
    await app.close();
  });
});

describe('POST /api/profiles', () => {
  it('создаёт профиль и возвращает его с id', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
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
    const response = await app.inject({
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
    const response = await app.inject({
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
    const response = await app.inject({
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
    const response = await app.inject({
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
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/profiles/${created.json().id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().weights).toEqual(VALID_WEIGHTS);
    await app.close();
  });

  it('отвечает 404 для неизвестного id', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/profiles/2b0f4a58-0e3c-4f5e-9f5a-1d8a3c9e7b21',
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('отвечает 400 для мусора вместо id', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
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
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { answers: { '1': 3 }, weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const nextWeights = VALID_WEIGHTS.map((w, i) => (i === 0 ? 100 : w - (100 - 50) / 23));
    const rounded = nextWeights.map((w) => Math.round(w));
    // приводим к точной сумме 1200, как это делает движок фронта
    rounded[1] += 1200 - rounded.reduce((a, b) => a + b, 0);

    const response = await app.inject({
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
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${created.json().id}`,
      payload: { weights: VALID_WEIGHTS.slice(0, 23) },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('отвечает 404 для неизвестного id', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
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
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const removed = await app.inject({ method: 'DELETE', url: `/api/profiles/${id}` });
    expect(removed.statusCode).toBe(204);

    const again = await app.inject({ method: 'GET', url: `/api/profiles/${id}` });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it('отвечает 404, когда профиля уже нет', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/profiles/2b0f4a58-0e3c-4f5e-9f5a-1d8a3c9e7b21',
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('принимает DELETE с content-type json и пустым телом', async () => {
    const { app } = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { weights: VALID_WEIGHTS },
    });
    const id = created.json().id;

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });
});

describe('тела запросов', () => {
  it('отклоняет битый JSON', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
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
    const response = await app.inject({
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