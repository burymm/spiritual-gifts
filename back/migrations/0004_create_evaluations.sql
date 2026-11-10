-- Оценки, присланные по ссылке-приглашению: пастор или друг раскладывает пул
-- весов (1200) по 24 качествам пригласившего — та же диаграмма, что и в
-- самооценке, поэтому веса хранятся в том же формате.
--
-- Приглашение на оценку одноразовое: used_at в invitations — отметка «оценка
-- завершена». Она же освобождает частичный уникальный индекс
-- (owner_email, email, role) where used_at is null, так что после ответа можно
-- выдать новую ссылку тому же человеку.

create table if not exists evaluations (
  id              uuid primary key default gen_random_uuid(),
  invitation_id   uuid not null unique references invitations(id) on delete cascade,
  owner_email     text not null,
  role            text not null,
  evaluator_email text not null,
  answers         jsonb not null default '{}'::jsonb,
  weights         jsonb not null,
  source          text not null default 'calibrated',
  created_at      timestamptz not null default now(),
  constraint evaluation_role_known check (role in ('pastor', 'friend')),
  constraint evaluation_source_known
    check (source in ('uniform', 'survey', 'calibrated', 'aggregate'))
);

create index if not exists evaluations_owner_idx
  on evaluations (owner_email, created_at desc);
