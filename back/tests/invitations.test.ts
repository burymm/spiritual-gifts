import type { FastifyInstance, InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/session.js';
import type { AuthConfig } from '../src/config.js';
import { MemoryInvitationRepository, MemoryProfileRepository } from './memory-repo.js';

const RULES = { qualityCount: 24, baseWeight: 50 };

const AUTH: AuthConfig = {
  mode: 'mock',
  secret: 'секрет-для-тестов-приглашений',
  secretEphemeral: false,
  frontOrigin: 'http://localhost:4200',
  apiPublicOrigin: 'http://127.0.0.1:3000',
  google: null,
  adminEmail: 'admin@example.com',
  tokenTtlSeconds: 3600,
};

const OWNER_EMAIL = 'owner@example.com';
const OWNER_TOKEN = signToken(
  { kind: 'session', email: OWNER_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 },
  AUTH.secret,
);

const GUEST_EMAIL = 'pastor@church.ru';
const GUEST_TOKEN = signToken(
  { kind: 'session', email: GUEST_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 },
  AUTH.secret,
);

/** Равномерная диаграмма: 24 качества по 50 — ровно пул 1200. */
const UNIFORM = Array.from({ length: 24 }, () => 50);

async function makeApp() {
  const repo = new MemoryProfileRepository();
  const invitations = new MemoryInvitationRepository();
  const app = await buildApp({ repo, invitations, rules: RULES, auth: AUTH });
  return { app, invitations };
}

function call(app: FastifyInstance, options: InjectOptions) {
  return app.inject({
    ...options,
    headers: { authorization: `Bearer ${OWNER_TOKEN}`, ...(options.headers ?? {}) },
  });
}

describe('POST /api/invitations', () => {
  it('создаёт приглашение и выдаёт ссылку без роли в токене', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: ' Pastor@Church.RU ', role: 'pastor' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const invitation = response.json();
    expect(invitation.email).toBe('pastor@church.ru');
    expect(invitation.role).toBe('pastor');
    // Токен — случайный ключ: роли и почты в нём не видно.
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(invitation.token).not.toContain('pastor');
    expect(invitation.token).not.toContain('owner');
    await app.close();
  });

  it('возвращает ту же ссылку для той же почты и роли', async () => {
    const { app } = await makeApp();
    const first = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: 'pastor@church.ru', role: 'pastor' },
    });
    const second = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: 'pastor@church.ru', role: 'pastor' },
    });
    const otherRole = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: 'pastor@church.ru', role: 'friend' },
    });

    expect(second.json().token).toBe(first.json().token);
    expect(otherRole.json().token).not.toBe(first.json().token);
    await app.close();
  });

  it('требует вход и отсекает плохие данные', async () => {
    const { app } = await makeApp();

    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      payload: { email: 'pastor@church.ru', role: 'pastor' },
    });
    expect(anonymous.statusCode).toBe(401);

    const badEmail = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: 'не-почта', role: 'pastor' },
    });
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json().issues).toContain('Нужен корректный адрес почты');

    const badRole = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: 'pastor@church.ru', role: 'враг' },
    });
    expect(badRole.statusCode).toBe(400);

    const self = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: OWNER_EMAIL, role: 'friend' },
    });
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe('Нельзя пригласить самого себя');
    await app.close();
  });
});

describe('GET /api/invitations/:token', () => {
  it('отдаёт роль по ссылке без входа', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: 'friend@mail.ru', role: 'friend' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/invitations/${created.json().token}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    // Почты в ответе нет: ссылку можно переслать дальше.
    expect(response.json()).toEqual({ role: 'friend', completed: false });
    await app.close();
  });

  it('отвечает 404 на чужой токен и 400 на мусор', async () => {
    const { app } = await makeApp();

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/invitations/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(unknown.statusCode).toBe(404);

    const garbage = await app.inject({
      method: 'GET',
      url: '/api/invitations/короткая',
    });
    expect(garbage.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/invitations/:token/evaluation', () => {
  async function invite(app: FastifyInstance, role: 'pastor' | 'friend' = 'pastor') {
    const created = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: GUEST_EMAIL, role },
    });
    return created.json().token as string;
  }

  function evaluate(app: FastifyInstance, token: string, weights: number[] = UNIFORM) {
    return app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/evaluation`,
      headers: { authorization: `Bearer ${GUEST_TOKEN}` },
      payload: { weights, source: 'calibrated' },
    });
  }

  it('принимает оценку и помечает ссылку использованной', async () => {
    const { app, invitations } = await makeApp();
    const token = await invite(app);

    const response = await evaluate(app, token);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ role: 'pastor', completed: true });
    expect(invitations.evaluations).toHaveLength(1);
    expect(invitations.evaluations[0].evaluatorEmail).toBe(GUEST_EMAIL);
    expect(invitations.evaluations[0].ownerEmail).toBe(OWNER_EMAIL);
    expect(invitations.evaluations[0].weights).toHaveLength(24);

    // Отметка видна публичному чтению ссылки: экран не предложит оценивать снова.
    const info = await app.inject({ method: 'GET', url: `/api/invitations/${token}` });
    expect(info.json()).toEqual({ role: 'pastor', completed: true });
    await app.close();
  });

  it('не принимает вторую оценку по той же ссылке', async () => {
    const { app, invitations } = await makeApp();
    const token = await invite(app);

    expect((await evaluate(app, token)).statusCode).toBe(201);
    const again = await evaluate(app, token);

    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('Оценка по этой ссылке уже отправлена');
    expect(invitations.evaluations).toHaveLength(1);
    await app.close();
  });

  it('требует вход и проверяет ссылку', async () => {
    const { app } = await makeApp();
    const token = await invite(app);

    const anonymous = await app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/evaluation`,
      payload: { weights: UNIFORM },
    });
    expect(anonymous.statusCode).toBe(401);

    const unknown = await evaluate(app, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it('не даёт оценить собственную анкету', async () => {
    const { app } = await makeApp();
    const token = await invite(app, 'friend');

    const response = await app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/evaluation`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: { weights: UNIFORM, source: 'calibrated' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(
      'Свою анкету не оценивают: приглашение для другого человека',
    );
    await app.close();
  });

  it('отклоняет веса, не сложившиеся в пул', async () => {
    const { app, invitations } = await makeApp();
    const token = await invite(app);

    const response = await evaluate(app, token, Array.from({ length: 24 }, () => 40));

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Некорректная оценка');
    expect(invitations.evaluations).toHaveLength(0);
    await app.close();
  });
});

describe('GET /api/invitations/mine', () => {
  it('отдаёт ссылки владельца с отметкой «оценка получена»', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: GUEST_EMAIL, role: 'pastor' },
    });
    const token = created.json().token as string;

    const pending = await call(app, { method: 'GET', url: '/api/invitations/mine' });
    expect(pending.statusCode).toBe(200);
    expect(pending.headers['cache-control']).toBe('no-store');
    expect(pending.json().invitations).toHaveLength(1);
    expect(pending.json().invitations[0]).toMatchObject({
      token,
      email: GUEST_EMAIL,
      role: 'pastor',
      usedAt: null,
    });

    await app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/evaluation`,
      headers: { authorization: `Bearer ${GUEST_TOKEN}` },
      payload: { weights: UNIFORM, source: 'calibrated' },
    });

    const done = await call(app, { method: 'GET', url: '/api/invitations/mine' });
    expect(done.json().invitations[0].usedAt).toEqual(expect.any(String));
    await app.close();
  });

  it('требует вход', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/invitations/mine' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /api/evaluations/mine', () => {
  it('отдаёт оценки без почты оценщика', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: GUEST_EMAIL, role: 'pastor' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/invitations/${created.json().token}/evaluation`,
      headers: { authorization: `Bearer ${GUEST_TOKEN}` },
      payload: { weights: UNIFORM, source: 'calibrated' },
    });

    const response = await call(app, { method: 'GET', url: '/api/evaluations/mine' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const [evaluation] = response.json().evaluations;
    expect(evaluation.role).toBe('pastor');
    expect(evaluation.weights).toEqual(UNIFORM);
    expect(evaluation).not.toHaveProperty('evaluatorEmail');
    expect(evaluation).not.toHaveProperty('ownerEmail');
    await app.close();
  });

  it('требует вход', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/evaluations/mine' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /api/invitations/:token/evaluation', () => {
  it('возвращает отправленную оценку её автору', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: GUEST_EMAIL, role: 'pastor' },
    });
    const token = created.json().token as string;
    await app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/evaluation`,
      headers: { authorization: `Bearer ${GUEST_TOKEN}` },
      payload: { weights: UNIFORM, source: 'calibrated' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/invitations/${token}/evaluation`,
      headers: { authorization: `Bearer ${GUEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      role: 'pastor',
      weights: UNIFORM,
      completed: true,
    });
    expect(response.json().createdAt).toEqual(expect.any(String));
    await app.close();
  });

  it('не отдаёт оценку владельцу и чужому', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: GUEST_EMAIL, role: 'pastor' },
    });
    const token = created.json().token as string;
    await app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/evaluation`,
      headers: { authorization: `Bearer ${GUEST_TOKEN}` },
      payload: { weights: UNIFORM, source: 'calibrated' },
    });

    const owner = await call(app, {
      method: 'GET',
      url: `/api/invitations/${token}/evaluation`,
    });
    expect(owner.statusCode).toBe(403);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/invitations/${token}/evaluation`,
    });
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });

  it('отвечает 404, пока оценку не отправили', async () => {
    const { app } = await makeApp();
    const created = await call(app, {
      method: 'POST',
      url: '/api/invitations',
      payload: { email: GUEST_EMAIL, role: 'pastor' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/invitations/${created.json().token}/evaluation`,
      headers: { authorization: `Bearer ${GUEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Оценка по этой ссылке ещё не отправлена');
    await app.close();
  });
});
