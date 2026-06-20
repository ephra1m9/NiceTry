-- Миграция: настройки блока Telegram Stars / Telegram Premium для админки.
--
-- Stars и Premium пока показываются на главной как заглушка «скоро в каталоге» (без реальной
-- покупки), но наценка и курс уже редактируются в админке заранее — как в proxy_settings,
-- единая наценка% и курс USD→₽ на оба продукта сразу.
--
-- Применять через service-role (psql / Supabase SQL editor). Идемпотентна.

CREATE TABLE IF NOT EXISTS telegram_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  markup_percent  DECIMAL(5, 2) NOT NULL DEFAULT 30 CHECK (markup_percent >= 0),
  usd_to_rub_rate DECIMAL(8, 2) NOT NULL DEFAULT 100 CHECK (usd_to_rub_rate > 0),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Настройки читаются всеми (наценка не секрет), пишутся только через service-role (админка).
ALTER TABLE telegram_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_settings_public_read ON telegram_settings;
CREATE POLICY telegram_settings_public_read ON telegram_settings
  FOR SELECT USING (TRUE);

-- Перезагрузка schema cache PostgREST (после DDL).
NOTIFY pgrst, 'reload schema';
