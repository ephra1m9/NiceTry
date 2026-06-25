-- Миграция: настройки блока eSIM (страница /esim) для админки.
--
-- Наценка%, курс USD→₽ и вкл/выкл витрины — НЕ хардкод и НЕ через общую таблицу categories
-- (variant/тариф приходят от Dessly на лету и не лежат в каталоге товаров), а отдельным
-- синглтоном — как proxy_settings/telegram_settings.
--
-- Применять через service-role (psql / Supabase SQL editor). Идемпотентна.

CREATE TABLE IF NOT EXISTS esim_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  markup_percent  DECIMAL(5, 2) NOT NULL DEFAULT 20 CHECK (markup_percent >= 0),
  usd_to_rub_rate DECIMAL(8, 2) NOT NULL DEFAULT 82 CHECK (usd_to_rub_rate > 0),
  -- Включает/выключает страницу /esim и пункт навигации.
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO esim_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Настройки читаются всеми (наценка не секрет), пишутся только через service-role (админка).
ALTER TABLE esim_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esim_settings_public_read ON esim_settings;
CREATE POLICY esim_settings_public_read ON esim_settings
  FOR SELECT USING (TRUE);

-- Перезагрузка schema cache PostgREST (после DDL).
NOTIFY pgrst, 'reload schema';
