-- Привязка профиля к аккаунту: почта владельца из входа (Google или эмуляция).
-- null — профиль создан без входа и доступен по ссылке-ключу (id),
-- как и раньше; после входа существующий профиль можно «забрать» себе.

alter table profiles add column if not exists owner_email text;

create index if not exists profiles_owner_email_idx
  on profiles (owner_email, updated_at desc)
  where owner_email is not null;
