import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { isAdminEmail, registerAuthRoutes, userOf } from './auth/routes.js';
import { DEFAULT_ADMIN_EMAIL, type AuthConfig } from './config.js';
import {
  createSchemas,
  issueMessages,
  type NewProfile,
  type WeightRules,
} from './domain/profile.js';
import type { ProfileRepository } from './repo/types.js';

export interface AppOptions {
  readonly repo: ProfileRepository;
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
  const { repo, rules } = options;
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