-- Миграция: таблица пакетов Telegram Stars/Premium, синхронизируемых из AppRoute кнопкой
-- в админке (POST /api/admin/sync-telegram), а не живым запросом на каждое открытие модалки.
--
-- /api/telegram/config и /api/telegram/buy читают ТОЛЬКО эту таблицу — обращение к AppRoute
-- (getService) происходит только во время синка. id = AppRoute denominationId (как есть,
-- без преобразований — передаётся в createDtuOrder при покупке).
--
-- Применять через service-role (psql / Supabase SQL editor). Идемпотентна.

CREATE TABLE IF NOT EXISTS telegram_packages (
  id           TEXT PRIMARY KEY,                                   -- AppRoute denominationId
  product_type TEXT NOT NULL CHECK (product_type IN ('stars', 'premium')),
  amount       INTEGER NOT NULL CHECK (amount > 0),                 -- кол-во звёзд / месяцев
  label        TEXT NOT NULL,                                       -- человекочитаемое название
  price_usd    DECIMAL(10, 4) NOT NULL CHECK (price_usd > 0),       -- цена поставщика, USD
  service_id   TEXT NOT NULL,                                       -- AppRoute serviceId (родитель)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_packages_type ON telegram_packages(product_type, sort_order);

-- Настройки читаются всеми (нужно для модалки покупки), пишутся только через service-role (синк).
ALTER TABLE telegram_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_packages_public_read ON telegram_packages;
CREATE POLICY telegram_packages_public_read ON telegram_packages
  FOR SELECT USING (TRUE);

NOTIFY pgrst, 'reload schema';
