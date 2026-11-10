-- Кого админ назначил пастором. Роль привязана к почте, а не к сессии: у
-- назначенного аккаунта появляется раздел «Пастор» на любом устройстве, а
-- снятие — одна удалённая запись. Почта — первичный ключ, поэтому повторное
-- назначение ничего не дублирует.

create table if not exists pastors (
  email       text primary key,
  assigned_at timestamptz not null default now(),
  assigned_by text
);
