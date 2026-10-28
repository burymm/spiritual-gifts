-- Профиль оценки: ответы анкеты + веса качеств.
-- id — UUID, он же ключ доступа без входа: ссылка вида /p/<id>.
-- Требуется PostgreSQL 13+ (gen_random_uuid() в ядре); Supabase отвечает этому.

create table if not exists profiles (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  answers     jsonb not null default '{}'::jsonb,
  weights     jsonb not null,
  source      text not null default 'uniform',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint answers_is_object check (jsonb_typeof(answers) = 'object'),
  constraint weights_is_array   check (jsonb_typeof(weights) = 'array'),
  constraint source_known       check (
    source in ('uniform', 'survey', 'calibrated', 'aggregate')
  )
);

create index if not exists profiles_updated_at_idx on profiles (updated_at desc);