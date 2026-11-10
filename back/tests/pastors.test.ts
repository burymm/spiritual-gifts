import type { FastifyInstance, InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { signToken } from '../src/auth/session.js';
import type { AuthConfig } from '../src/config.js';
import {
  MemoryInvitationRepository,
  MemoryPastorRepository,
  MemoryProfileRepository,
} from './memory-repo.js';

const RULES = { qualityCount: 24, baseWeight: 50 };

const AUTH: AuthConfig = {
  mode: 'mock',
  secret: 'секрет-для-тестов-пасторов',
  secretEphemeral: false,
  frontOrigin: 'http://localhost:4200',
  apiPublicOrigin: 'http://127.0.0.1:3000',
  google: null,
  adminEmail: 'admin@example.com',
  tokenTtlSeconds: 3600,
};

function token(email: string): string {
  return signToken(
    { kind: 'session', email, exp: Math.floor(Date.now() / 1000) + 3600 },
    AUTH.secret,
  );
}

const ADMIN_TOKEN = token(AUTH.adminEmail);
const USER_TOKEN = token('owner@example.com');

async function makeApp() {
  const repo = new MemoryProfileRepository();
  const pastors = new MemoryPastorRepository();
  const invitations = new MemoryInvitationRepository();
  const app = await buildApp({ repo, invitations, pastors, rules: RULES, auth: AUTH });
  return { app, pastors, repo, invitations };
}

/** Равномерная диаграмма: 24 качества по 50 — ровно пул 1200. */
const UNIFORM = Array.from({ length: 24 }, () => 50);

function call(app: FastifyInstance, options: InjectOptions, as = ADMIN_TOKEN) {
  return app.inject({
    ...options,
    headers: { authorization: `Bearer ${as}`, ...(options.headers ?? {}) },
  });
}

describe('POST /api/admin/pastors', () => {
  it('назначает пастора и показывает его в списке', async () => {
    const { app } = await makeApp();
    const assigned = await call(app, {
      method: 'POST',
      url: '/api/admin/pastors',
      payload: { email: ' Pastor@Church.RU ' },
    });

    expect(assigned.statusCode).toBe(201);
    const pastor = assigned.json();
    expect(pastor.email).toBe('pastor@church.ru');
    expect(pastor.assignedBy).toBe(AUTH.adminEmail);

    const list = await call(app, { method: 'GET', url: '/api/admin/pastors' });
    expect(list.statusCode).toBe(200);
    expect(list.json().pastors).toHaveLength(1);
    expect(list.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('повторное назначение не плодит записи', async () => {
    const { app } = await makeApp();
    const first = await call(app, {
      method: 'POST',
      url: '/api/admin/pastors',
      payload: { email: 'pastor@church.ru' },
    });
    const second = await call(app, {
      method: 'POST',
      url: '/api/admin/pastors',
      payload: { email: 'pastor@church.ru' },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().email).toBe('pastor@church.ru');

    const list = await call(app, { method: 'GET', url: '/api/admin/pastors' });
    expect(list.json().pastors).toHaveLength(1);
    await app.close();
  });

  it('отклоняет некорректную почту', async () => {
    const { app } = await makeApp();
    const response = await call(app, {
      method: 'POST',
      url: '/api/admin/pastors',
      payload: { email: 'не почта' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('пускает только администратора', async () => {
    const { app } = await makeApp();
    const asUser = await call(
      app,
      {
        method: 'POST',
        url: '/api/admin/pastors',
        payload: { email: 'pastor@church.ru' },
      },
      USER_TOKEN,
    );
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/admin/pastors',
      payload: { email: 'pastor@church.ru' },
    });

    expect(asUser.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });
});

describe('DELETE /api/admin/pastors/:email', () => {
  it('снимает пастора; повторное снятие — 404', async () => {
    const { app, pastors } = await makeApp();
    await pastors.assign('pastor@church.ru', AUTH.adminEmail);

    const removed = await call(app, {
      method: 'DELETE',
      url: '/api/admin/pastors/pastor%40church.ru',
    });
    const again = await call(app, {
      method: 'DELETE',
      url: '/api/admin/pastors/pastor%40church.ru',
    });

    expect(removed.statusCode).toBe(204);
    expect(again.statusCode).toBe(404);

    const list = await call(app, { method: 'GET', url: '/api/admin/pastors' });
    expect(list.json().pastors).toHaveLength(0);
    await app.close();
  });

  it('не даёт снять пастора обычному пользователю', async () => {
    const { app, pastors } = await makeApp();
    await pastors.assign('pastor@church.ru', AUTH.adminEmail);

    const response = await call(
      app,
      { method: 'DELETE', url: '/api/admin/pastors/pastor%40church.ru' },
      USER_TOKEN,
    );

    expect(response.statusCode).toBe(403);
    expect(await pastors.find('pastor@church.ru')).not.toBeNull();
    await app.close();
  });
});

describe('GET /api/pastors/me', () => {
  it('флаг ставится назначенному пастору', async () => {
    const { app, pastors } = await makeApp();
    const before = await call(
      app,
      { method: 'GET', url: '/api/pastors/me' },
      USER_TOKEN,
    );
    expect(before.json()).toEqual({ pastor: false, assignedAt: null });

    await pastors.assign('owner@example.com', AUTH.adminEmail);
    const after = await call(
      app,
      { method: 'GET', url: '/api/pastors/me' },
      USER_TOKEN,
    );

    expect(after.statusCode).toBe(200);
    expect(after.json().pastor).toBe(true);
    expect(typeof after.json().assignedAt).toBe('string');
    expect(after.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('без входа — 401', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/pastors/me' });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /api/pastor/profiles', () => {
  it('показывает пастору только тех, кто прислал ему анкету', async () => {
    const { app, pastors, repo, invitations } = await makeApp();
    await pastors.assign('owner@example.com', AUTH.adminEmail);

    // Профиль есть у всех трёх, но пастором приглашён только один.
    for (const member of ['member@example.com', 'stranger@example.com']) {
      await repo.create({
        title: null,
        answers: {},
        weights: UNIFORM,
        source: 'calibrated',
        ownerEmail: member,
      });
    }
    await repo.create({
      title: null,
      answers: {},
      weights: UNIFORM,
      source: 'calibrated',
      ownerEmail: 'owner@example.com',
    });

    const invitation = await invitations.createPending({
      email: 'owner@example.com',
      role: 'pastor',
      ownerEmail: 'member@example.com',
    });
    expect(invitation.token).toHaveLength(43);
    await invitations.recordEvaluation(invitation.id, {
      answers: {},
      weights: UNIFORM,
      source: 'calibrated',
      evaluatorEmail: 'owner@example.com',
    });

    const response = await call(
      app,
      { method: 'GET', url: '/api/pastor/profiles' },
      USER_TOKEN,
    );

    expect(response.statusCode).toBe(200);
    const members = response.json().members;
    expect(members).toHaveLength(1);
    expect(members[0].email).toBe('member@example.com');
    expect(members[0].role).toBe('pastor');
    expect(members[0].profile.id).toBeDefined();
    expect(members[0].evaluations).toHaveLength(1);
    // Почта оценщика наружу не уходит: 360° анонимен.
    expect(members[0].evaluations[0].evaluatorEmail).toBeUndefined();
    await app.close();
  });

  it('пускает только назначенного пастора', async () => {
    const { app } = await makeApp();
    const response = await call(
      app,
      { method: 'GET', url: '/api/pastor/profiles' },
      USER_TOKEN,
    );

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('показывает человека без профиля — с profile: null', async () => {
    const { app, pastors, invitations } = await makeApp();
    await pastors.assign('owner@example.com', AUTH.adminEmail);
    await invitations.createPending({
      email: 'owner@example.com',
      role: 'friend',
      ownerEmail: 'noprofile@example.com',
    });

    const response = await call(
      app,
      { method: 'GET', url: '/api/pastor/profiles' },
      USER_TOKEN,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().members).toEqual([
      expect.objectContaining({ email: 'noprofile@example.com', profile: null }),
    ]);
    await app.close();
  });
});

describe('GET /api/admin/evaluations', () => {
  it('отдаёт админу оценки всех пользователей', async () => {
    const { app, repo, invitations } = await makeApp();
    for (const member of ['first@example.com', 'second@example.com']) {
      await repo.create({
        title: null,
        answers: {},
        weights: UNIFORM,
        source: 'uniform',
        ownerEmail: member,
      });
      const invitation = await invitations.createPending({
        email: 'pastor@church.ru',
        role: 'pastor',
        ownerEmail: member,
      });
      await invitations.recordEvaluation(invitation.id, {
        answers: {},
        weights: UNIFORM,
        source: 'calibrated',
        evaluatorEmail: 'pastor@church.ru',
      });
    }

    const response = await call(app, {
      method: 'GET',
      url: '/api/admin/evaluations',
    });

    expect(response.statusCode).toBe(200);
    const evaluations = response.json().evaluations;
    expect(evaluations).toHaveLength(2);
    expect(evaluations.map((item: { ownerEmail: string }) => item.ownerEmail).sort()).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
    expect(evaluations[0].evaluatorEmail).toBeUndefined();
    await app.close();
  });

  it('обычному пользователю — 403, без входа — 401', async () => {
    const { app } = await makeApp();
    const asUser = await call(
      app,
      { method: 'GET', url: '/api/admin/evaluations' },
      USER_TOKEN,
    );
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/admin/evaluations',
    });

    expect(asUser.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });
});
