import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

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
  readonly logger?: boolean;
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
  const schemas = createSchemas(rules);

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.corsOrigin ?? true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'Маршрут не найден' }),
  );

  app.get('/api/health', async (_request, reply) => {
    const up = await repo.ping();
    return reply.code(up ? 200 : 503).send({ status: up ? 'ok' : 'degraded', db: up });
  });

  // Создать профиль: { title?, answers?, weights, source? }
  app.post('/api/profiles', async (request, reply) => {
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
    };
    const profile = await repo.create(input);
    return reply.code(201).send(profile);
  });

  // Прочитать профиль по ссылке
  app.get<{ Params: IdParams }>('/api/profiles/:id', async (request, reply) => {
    const id = schemas.id.safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: 'Некорректный идентификатор профиля' });
    }

    const profile = await repo.findById(id.data);
    if (profile === null) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }
    return reply.send(profile);
  });

  // Частичное обновление; итоговая запись проверяется целиком
  app.patch<{ Params: IdParams }>('/api/profiles/:id', async (request, reply) => {
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
    });
    return reply.send(updated);
  });

  // Удалить профиль
  app.delete<{ Params: IdParams }>('/api/profiles/:id', async (request, reply) => {
    const id = schemas.id.safeParse(request.params.id);
    if (!id.success) {
      return reply.code(400).send({ error: 'Некорректный идентификатор профиля' });
    }

    const removed = await repo.remove(id.data);
    if (!removed) {
      return reply.code(404).send({ error: 'Профиль не найден' });
    }
    return reply.code(204).send();
  });

  return app;
}