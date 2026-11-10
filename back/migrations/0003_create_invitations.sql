-- Приглашения оценить профиль: пастор или друг.
-- token — непрозрачный ключ ссылки (/invite/<token>): ни роль, ни почты из
-- него не читаются, всё это лежит в записи. Почта приглашённого хранится,
-- чтобы ссылка была привязана к конкретному человеку.
-- Один неиспользованный инвайт на пару (владелец, почта, роль): повторный
-- ввод той же почты возвращает уже выданную ссылку, а не плодит записи.

create table if not exists invitations (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  role        text not null,
  email       text not null,
  owner_email text not null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  constraint invitation_role_known check (role in ('pastor', 'friend'))
);

create unique index if not exists invitations_pending_idx
  on invitations (owner_email, email, role)
  where used_at is null;

create index if not exists invitations_owner_idx
  on invitations (owner_email, created_at desc);
