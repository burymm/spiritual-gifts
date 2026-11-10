import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { isAdminEmail, registerAuthRoutes, userOf } from './auth/routes.js';
import { DEFAULT_ADMIN_EMAIL, type AuthConfig } from './config.js';
import {
  INVITE_TOKEN_PATTERN,
  inviteSchema,
  type InvitationRole,
} from './domain/invitation.js';
import { pastorSchema } from './domain/pastor.js';
import {
  createSchemas,
  issueMessages,
  type NewProfile,
  type WeightRules,
} from './domain/profile.js';
import type {
  InvitationRepository,
  PastorRepository,
  ProfileRepository,
} from './repo/types.js';

export interface AppOptions {
  readonly repo: ProfileRepository;
  /** Ссылки-приглашения; без них приглашать некого — роут отвечает 503. */
  readonly invitations?: InvitationRepository;
  /** Назначенные пасторы; без них раздел «Пастор» никому не открыт. */
  readonly pastors?: PastorRepository;
  readonly rules: WeightRules;
  readonly corsOrigin?: string;
  /** Настройки входа; без них — эмуляция входа (так удобно в тестах). */
  readonly auth?: AuthConfig;
  readonly logger?: boolean;
  /**
   * Каталог со собранным фронтом (back/public). Задан — Fastify раздаёт его
   * как статику и отдаёт index.html на неизвестные не-API маршруты (SPA);
   * не задан — работает только API (тесты, dev через ng serve).
   */
  readonly staticDir?: string;
}

/**
 * Ищет собранный фронт. Путь зависит от того, откуда запущен код —
 * src/, dist/ или бандл на Vercel (handler лежит в back/src/server.mjs),
 * поэтому перебираем кандидатов и берём первый с index.html.
 */
export function findStaticDir(): string | null {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'public'),
    path.resolve(process.cwd(), 'back/public'),
    path.resolve(here, '../public'), // src/ и бандл back/src → back/public
    path.resolve(here, '../../back/public'),
    path.resolve(here, '../../../back/public'), // dist/src → back/public
  ];
  return (
    candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? null
  );
}

/** Конфигурация по умолчанию: режим mock, секрет живёт только до рестарта. */
function fallbackAuth(): AuthConfig {
  return {
    mode: 'mock',
    secret: 'fallback-secret-только-для-тестов',
    secretEphemeral: true,
    frontOrigin: 'http://localhost:4200',
    apiPublicOrigin: 'http://127.0.0.1:3000',
    google: null,
    adminEmail: DEFAULT_ADMIN_EMAIL,
    tokenTtlSeconds: 720 * 3600,
  };
}

interface IdParams {
  id: string;
}

interface TokenParams {
  token: string;
}

interface EmailParams {
  email: string;
}

/** Коды, по которым понятно, что упала именно база, а не логика запроса. */
const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '57P03', // cannot connect now
  '28P01', // auth failed
  '3D000', // database does not exist
]);

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { repo, rules, invitations, pastors } = options;
  const auth = options.auth ?? fallbackAuth();
  const schemas = createSchemas(rules);

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.corsOrigin ?? true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Fastify по умолчанию отклоняет запрос с content-type json и пустым телом
  // (классическая ситуация для DELETE). Пустое тело трактуем как «нет payload».
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const raw = typeof body === 'string' ? body.trim() : '';
      if (raw === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch {
        const error = new Error('Некорректный JSON в теле запроса') as Error & {
          statusCode?: number;
        };
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const code = (error as FastifyError & { code?: string }).code;
    if (code !== undefined && DB_UNAVAILABLE_CODES.has(code)) {
      return reply
        .code(503)
        .send({ error: 'База данных недоступна. Проверьте DATABASE_URL.' });
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  const staticDir = options.staticDir;
  if (staticDir !== undefined) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      index: ['index.html'],
      setHeaders(res, filePath) {
        // index.html меняется при каждом релизе — без кэша; хэшированные
        // ассеты (main-ABC123DEF.js) — навсегда.
        if (filePath.endsWith('index.html')) {
          res.setHeader('cache-control', 'no-cache');
        } else if (/[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(filePath)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('cache-control', 'public, max-age=300');
        }
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const wantsHtml =
      (request.method === 'GET' || request.method === 'HEAD') &&
      (request.headers.accept ?? '').includes('text/html');
    if (
      staticDir !== undefined &&
      wantsHtml &&
      !request.url.startsWith('/api')
    ) {
      // SPA: любой неизвестный не-API маршрут отдаёт index.html
      return reply.code(200).type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Маршрут не найден' });
  });

  app.get('/api/health', async (_request, reply) => {
    const up = await repo.ping();
    return reply.code(up ? 200 : 503).send({ status: up ? 'ok' : 'degraded', db: up });
  });

  registerAuthRoutes(app, auth);

  // Все последние профили — только администратору. Ответы отдаём как есть:
  // результат считает тот же движок фронта, поэтому дублировать его на бэке
  // не нужно. no-store — это персональные данные.
  app.get('/api/admin/profiles', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (!isAdminEmail(email, auth)) {
      return reply.code(403).send({ error: 'Доступ только для администратора' });
    }

    reply.header('cache-control', 'no-store');
    return reply.send(await repo.listLatest());
  });

  // Кого админ назначил пастором. Список нужен только админке.
  app.get('/api/admin/pastors', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (!isAdminEmail(email, auth)) {
      return reply.code(403).send({ error: 'Доступ только для администратора' });
    }
    if (pastors === undefined) {
      return reply.code(503).send({ error: 'Пасторы недоступны: не подключено хранилище' });
    }

    reply.header('cache-control', 'no-store');
    return reply.send({ pastors: await pastors.list() });
  });

  // Назначить пастора: { email }. Повторное назначение не ошибка — запись та же.
  app.post('/api/admin/pastors', async (request, reply) => {
    const adminEmail = userOf(request, auth);
    if (adminEmail === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (!isAdminEmail(adminEmail, auth)) {
      return reply.code(403).send({ error: 'Доступ только для администратора' });
    }
    if (pastors === undefined) {
      return reply.code(503).send({ error: 'Пасторы недоступны: не подключено хранилище' });
    }

    const parsed = pastorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Некорректная почта', issues: issueMessages(parsed.error) });
    }

    const { pastor, created } = await pastors.assign(parsed.data.email, adminEmail);
    reply.header('cache-control', 'no-store');
    return reply.code(created ? 201 : 200).send(pastor);
  });

  // Снять пастора: запись удаляется, раздел у этого аккаунта закрывается.
  app.delete<{ Params: EmailParams }>(
    '/api/admin/pastors/:email',
    async (request, reply) => {
      const adminEmail = userOf(request, auth);
      if (adminEmail === null) {
        return reply.code(401).send({ error: 'Вход не выполнен' });
      }
      if (!isAdminEmail(adminEmail, auth)) {
        return reply.code(403).send({ error: 'Доступ только для администратора' });
      }
      if (pastors === undefined) {
        return reply.code(503).send({ error: 'Пасторы недоступны: не подключено хранилище' });
      }

      const parsed = pastorSchema.safeParse({ email: request.params.email });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Некорректная почта' });
      }
      const removed = await pastors.remove(parsed.data.email);
      if (!removed) {
        return reply.code(404).send({ error: 'Этот человек не был назначен пастором' });
      }
      return reply.code(204).send();
    },
  );

  // Средний результат по всем: админ видит оценки каждого пользователя, чтобы
  // включать тумблер «показывать средний» в своём списке.
  app.get('/api/admin/evaluations', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (!isAdminEmail(email, auth)) {
      return reply.code(403).send({ error: 'Доступ только для администратора' });
    }
    if (invitations === undefined) {
      return reply.code(503).send({ error: 'Оценки недоступны: не подключено хранилище' });
    }

    const list = await invitations.listAllEvaluations();
    reply.header('cache-control', 'no-store');
    return reply.send({
      evaluations: list.map(({ id, ownerEmail, role, source, weights, createdAt }) => ({
        id,
        ownerEmail,
        role,
        source,
        weights,
        createdAt,
      })),
    });
  });

  // Люди, которые прислали этому пастору анкету на оценку: он видит их профили
  // и присланные им оценки. Это и есть «члены своей церкви» — тот, кто позвал
  // пастора; всех пользователей видит только админ.
  app.get('/api/pastor/profiles', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (pastors === undefined || invitations === undefined) {
      return reply.code(503).send({ error: 'Раздел пастора недоступен: не подключено хранилище' });
    }
    if ((await pastors.find(email)) === null) {
      return reply
        .code(403)
        .send({ error: 'Раздел доступен только назначенным пасторам' });
    }

    const invited = await invitations.listByInvitee(email);
    const owners = new Map<string, { invitedAt: string; role: InvitationRole }>();
    for (const invitation of invited) {
      const current = owners.get(invitation.ownerEmail);
      if (current === undefined || invitation.createdAt > current.invitedAt) {
        owners.set(invitation.ownerEmail, {
          invitedAt: invitation.createdAt,
          role: invitation.role,
        });
      }
    }

    const members = [];
    for (const [ownerEmail, info] of owners) {
      const profile = await repo.findLatestByOwner(ownerEmail);
      const evaluations = await invitations.listEvaluationsByOwner(ownerEmail);
      members.push({
        email: ownerEmail,
        invitedAt: info.invitedAt,
        role: info.role,
        profile,
        evaluations: evaluations.map(({ id, role, source, weights, createdAt }) => ({
          id,
          role,
          source,
          weights,
          createdAt,
        })),
      });
    }
    members.sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));

    reply.header('cache-control', 'no-store');
    return reply.send({ members });
  });

  // Флаг для шапки и гарда страницы «Пастор»: назначение живёт в базе, а не
  // в токене, поэтому снятие роли действует сразу.
  app.get('/api/pastors/me', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }

    const pastor = pastors === undefined ? null : await pastors.find(email);
    reply.header('cache-control', 'no-store');
    return reply.send({
      pastor: pastor !== null,
      assignedAt: pastor?.assignedAt ?? null,
    });
  });

  // Создать профиль: { title?, answers?, weights, source? }
  app.post('/api/profiles', async (request, reply) => {
    const ownerEmail = userOf(request, auth);
    if (ownerEmail === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }

    const parsed = schemas.create.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Некорректный профиль', issues: issueMessages(parsed.error) });
    }

    const input: NewProfile = {
      title: parsed.data.title ?? null,
      answers: parsed.data.answers,
      weights: parsed.data.weights,
      source: parsed.data.source,
      // Владелец — из токена, а не из тела: клиент не может записать чужую почту.
      ownerEmail,
    };
    const profile = await repo.create(input);
    return reply.code(201).send(profile);
  });

  // Профиль вошедшего пользователя: фронт берёт его сразу после входа
  app.get('/api/profiles/mine', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    const profile = await repo.findLatestByOwner(email);
    if (profile === null) {
      return reply.code(404).send({ error: 'Сохранённого профиля пока нет' });
    }
    return reply.send(profile);
  });

  // Приглашение оценить профиль. Ссылка выдаётся только после записи в базу:
  // роль и почта приглашённого живут в записи, в URL — непрозрачный токен.
  app.post('/api/invitations', async (request, reply) => {
    const ownerEmail = userOf(request, auth);
    if (ownerEmail === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (invitations === undefined) {
      return reply.code(503).send({ error: 'Приглашения недоступны: не подключено хранилище' });
    }

    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Некорректное приглашение', issues: issueMessages(parsed.error) });
    }
    if (parsed.data.email === ownerEmail) {
      return reply.code(400).send({ error: 'Нельзя пригласить самого себя' });
    }

    const invitation = await invitations.createPending({
      email: parsed.data.email,
      role: parsed.data.role,
      ownerEmail,
    });
    reply.header('cache-control', 'no-store');
    return reply.code(201).send({
      token: invitation.token,
      email: invitation.email,
      role: invitation.role,
    });
  });

  // Ссылки вошедшего владельца: экран результата отмечает, кто уже прошёл,
  // и закрывает использованные ссылки. Для использованной ссылки статус —
  // `usedAt`; сама ссылка остаётся в ответе, но фронт её больше не предлагает.
  app.get('/api/invitations/mine', async (request, reply) => {
    const ownerEmail = userOf(request, auth);
    if (ownerEmail === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (invitations === undefined) {
      return reply.code(503).send({ error: 'Приглашения недоступны: не подключено хранилище' });
    }

    const list = await invitations.listByOwner(ownerEmail);
    reply.header('cache-control', 'no-store');
    return reply.send({
      invitations: list.map(({ token, email, role, createdAt, usedAt }) => ({
        token,
        email,
        role,
        createdAt,
        usedAt,
      })),
    });
  });

  // Роль по токену — без входа: приглашённому регистрация не нужна. Ни почту
  // владельца, ни почту приглашённого не отдаём: ссылка может уйти дальше.
  // `completed` — оценка уже прислана, ссылка одноразовая.
  app.get<{ Params: TokenParams }>('/api/invitations/:token', async (request, reply) => {
    if (invitations === undefined) {
      return reply.code(503).send({ error: 'Приглашения недоступны: не подключено хранилище' });
    }

    const token = request.params.token.trim();
    if (!INVITE_TOKEN_PATTERN.test(token)) {
      return reply.code(400).send({ error: 'Некорректная ссылка-приглашение' });
    }

    const invitation = await invitations.findByToken(token);
    if (invitation === null) {
      return reply.code(404).send({ error: 'Приглашение не найдено' });
    }
    reply.header('cache-control', 'no-store');
    return reply.send({
      role: invitation.role,
      completed: invitation.usedAt !== null,
    });
  });

  // Оценка по ссылке: { weights, answers?, source? } — та же диаграмма, что и в
  // самооценке, но в роли приглашённого. Почта оценщика — из сессии, поэтому
  // без входа нельзя, а ссылка одноразовая: вторая оценка получит 409.
  app.post<{ Params: TokenParams }>(
    '/api/invitations/:token/evaluation',
    async (request, reply) => {
      const evaluatorEmail = userOf(request, auth);
      if (evaluatorEmail === null) {
        return reply.code(401).send({ error: 'Вход не выполнен' });
      }
      if (invitations === undefined) {
        return reply.code(503).send({ error: 'Приглашения недоступны: не подключено хранилище' });
      }

      const token = request.params.token.trim();
      if (!INVITE_TOKEN_PATTERN.test(token)) {
        return reply.code(400).send({ error: 'Некорректная ссылка-приглашение' });
      }

      const parsed = schemas.create.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Некорректная оценка',
          issues: issueMessages(parsed.error),
        });
      }

      const invitation = await invitations.findByToken(token);
      if (invitation === null) {
        return reply.code(404).send({ error: 'Приглашение не найдено' });
      }
      if (invitation.ownerEmail === evaluatorEmail) {
        return reply
          .code(400)
          .send({ error: 'Свою анкету не оценивают: приглашение для другого человека' });
      }
      if (invitation.usedAt !== null) {
        return reply.code(409).send({ error: 'Оценка по этой ссылке уже отправлена' });
      }

      const evaluation = await invitations.recordEvaluation(invitation.id, {
        answers: parsed.data.answers,
        weights: parsed.data.weights,
        source: parsed.data.source,
        evaluatorEmail,
      });
      if (evaluation === null) {
        return reply.code(409).send({ error: 'Оценка по этой ссылке уже отправлена' });
      }

      reply.header('cache-control', 'no-store');
      return reply.code(201).send({
        role: invitation.role,
        completed: true,
      });
    },
  );

  // Присланные оценки — для среднего результата владельца. Почту оценщика не
  // отдаём: 360° анонимен, а роли достаточно, чтобы объяснить вклад.
  app.get('/api/evaluations/mine', async (request, reply) => {
    const ownerEmail = userOf(request, auth);
    if (ownerEmail === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }
    if (invitations === undefined) {
      return reply.code(503).send({ error: 'Оценки недоступны: не подключено хранилище' });
    }

    const list = await invitations.listEvaluationsByOwner(ownerEmail);
    reply.header('cache-control', 'no-store');
    return reply.send({
      evaluations: list.map(({ id, role, source, weights, createdAt }) => ({
        id,
        role,
        source,
        weights,
        createdAt,
      })),
    });
  });

  // Своя отправленная оценка по ссылке: после отправки приглашённый может
  // перечитать результат. Чужой оценки по токену не отдаём — 403.
  app.get<{ Params: TokenParams }>(
    '/api/invitations/:token/evaluation',
    async (request, reply) => {
      const email = userOf(request, auth);
      if (email === null) {
        return reply.code(401).send({ error: 'Вход не выполнен' });
      }
      if (invitations === undefined) {
        return reply.code(503).send({ error: 'Оценки недоступны: не подключено хранилище' });
      }

      const token = request.params.token.trim();
      if (!INVITE_TOKEN_PATTERN.test(token)) {
        return reply.code(400).send({ error: 'Некорректная ссылка-приглашение' });
      }

      const invitation = await invitations.findByToken(token);
      if (invitation === null) {
        return reply.code(404).send({ error: 'Приглашение не найдено' });
      }

      const evaluation = await invitations.findEvaluationByToken(token);
      if (evaluation === null) {
        return reply.code(404).send({ error: 'Оценка по этой ссылке ещё не отправлена' });
      }
      if (evaluation.evaluatorEmail !== email) {
        return reply
          .code(403)
          .send({ error: 'Эту оценку может посмотреть только её автор' });
      }

      reply.header('cache-control', 'no-store');
      return reply.send({
        role: evaluation.role,
        answers: evaluation.answers,
        weights: evaluation.weights,
        source: evaluation.source,
        createdAt: evaluation.createdAt,
        completed: true,
      });
    },
  );

  // Прочитать профиль по ссылке. Чужой (привязанный к другой почте) — 404,
  // чтобы сам факт существования не выдавался.
  app.get<{ Params: IdParams }>('/api/profiles/:id', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }

    const id = schemas.id.safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: 'Некорректный идентификатор профиля' });
    }

    const profile = await repo.findById(id.data);
    if (profile === null) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }
    if (profile.ownerEmail !== null && profile.ownerEmail !== email) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }
    return reply.send(profile);
  });

  // Частичное обновление; итоговая запись проверяется целиком
  app.patch<{ Params: IdParams }>('/api/profiles/:id', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }

    const id = schemas.id.safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: 'Некорректный идентификатор профиля' });
    }

    const patch = schemas.patch.safeParse(request.body);
    if (!patch.success) {
      return reply
        .code(400)
        .send({ error: 'Некорректные данные', issues: issueMessages(patch.error) });
    }

    const existing = await repo.findById(id.data);
    if (existing === null) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }
    if (existing.ownerEmail !== null && existing.ownerEmail !== email) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }

    const merged = {
      title: patch.data.title !== undefined ? patch.data.title ?? null : existing.title,
      answers: patch.data.answers ?? existing.answers,
      weights: patch.data.weights ?? existing.weights,
      source: patch.data.source ?? existing.source,
    };

    const full = schemas.create.safeParse(merged);
    if (!full.success) {
      return reply
        .code(400)
        .send({ error: 'Некорректный профиль после обновления', issues: issueMessages(full.error) });
    }

    const updated = await repo.update(id.data, {
      title: full.data.title ?? null,
      answers: full.data.answers,
      weights: full.data.weights,
      source: full.data.source,
      // Профиль, сохранённый до появления обязательного входа, забирает себе
      // первый вошедший; свой остаётся своим.
      ownerEmail: existing.ownerEmail ?? email,
    });
    return reply.send(updated);
  });

  // Удалить профиль
  app.delete<{ Params: IdParams }>('/api/profiles/:id', async (request, reply) => {
    const email = userOf(request, auth);
    if (email === null) {
      return reply.code(401).send({ error: 'Вход не выполнен' });
    }

    const id = schemas.id.safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: 'Некорректный идентификатор профиля' });
    }

    const existing = await repo.findById(id.data);
    if (existing === null) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }
    if (existing.ownerEmail !== null && existing.ownerEmail !== email) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }

    await repo.remove(id.data);
    return reply.code(204).send();
  });

  return app;
}