-- Миграция: вход по коду через Resend + никнеймы.
--
-- Контекст: переходим с magic-link/OTP Supabase на собственный 6-значный код, который шлём
-- через Resend. Эта миграция добавляет:
--   1) таблицу auth_codes — одноразовые коды входа (храним ТОЛЬКО хеш кода, не сам код);
--   2) колонку users.nickname — публичный ник (UNIQUE, выставляется после регистрации),
--      допускается временно NULL до шага выбора ника.
--
-- Сессия по-прежнему Supabase (users.id = auth.users.id) — этот код-вход после проверки кода
-- минтит обычную Supabase-сессию на сервере. Поэтому auth_codes — вспомогательная таблица,
-- все операции с ней идут ТОЛЬКО через service-role (серверные роуты), клиент её не читает/пишет.
--
-- Применять через service-role (Supabase SQL Editor / psql). Идемпотентна — можно прогонять повторно.

-- ============================================
-- 1. НИКНЕЙМ В users
-- ============================================
-- Добавляем nullable-колонку (существующие пользователи без ника не ломаются; ник выберут позже).
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;

-- Уникальность ника без учёта регистра (Nick == nick == NICK).
-- Частичный уникальный индекс: NULL-ники (ещё не выбрали) в ограничение не попадают.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname_lower
  ON users (LOWER(nickname))
  WHERE nickname IS NOT NULL;

-- Индекс по email уже есть (idx_users_email из supabase_schema.sql). Email в users всегда
-- хранится Supabase-аутентификацией; поиск по нику → email делаем через LOWER(nickname).

-- ============================================
-- 2. ОДНОРАЗОВЫЕ КОДЫ ВХОДА (auth_codes)
-- ============================================
CREATE TABLE IF NOT EXISTS auth_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Почта, на которую отправлен код. Всегда в нижнем регистре (нормализуем в коде).
  email       TEXT NOT NULL,
  -- Хеш кода (HMAC-SHA256 с серверным секретом). Сам код в БД НЕ хранится.
  code_hash   TEXT NOT NULL,
  -- Срок жизни кода (AUTH_CODE_TTL_MINUTES от момента создания).
  expires_at  TIMESTAMPTZ NOT NULL,
  -- Счётчик неудачных попыток ввода — блокируем код после лимита (анти-перебор).
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- Когда код был успешно использован (одноразовость). NULL = ещё не использован.
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Поиск активного кода по почте — берём самый свежий неиспользованный.
CREATE INDEX IF NOT EXISTS idx_auth_codes_email      ON auth_codes (email);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires_at ON auth_codes (expires_at);

-- RLS: таблица обслуживается исключительно service-role (серверные роуты). Клиентам — запрет.
-- Без единой политики и при включённом RLS anon/auth-роль не получает доступа, service-role
-- (используется в supabaseAdmin) RLS обходит.
ALTER TABLE auth_codes ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. ПЕРЕЗАГРУЗКА SCHEMA CACHE PostgREST (после DDL)
-- ============================================
NOTIFY pgrst, 'reload schema';
