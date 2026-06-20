-- Миграция: заказы Telegram Stars / Telegram Premium.
--
-- Живого поставщика (как px6 у прокси) нет, поэтому выдача РУЧНАЯ: заказ фиксируется здесь
-- со статусом pending, звёзды/подписку отправляем получателю (recipient_username) вручную,
-- после чего статус переводится в completed (вручную в Supabase, пока нет отдельной админки).
-- Деньги списывает /api/telegram/buy через service-role СРАЗУ при оформлении заказа.
--
-- Применять через service-role (psql / Supabase SQL editor). Идемпотентна.

CREATE TABLE IF NOT EXISTS telegram_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,

  product_type        TEXT NOT NULL CHECK (product_type IN ('stars', 'premium')),
  amount              INTEGER NOT NULL CHECK (amount > 0), -- кол-во звёзд (stars) или месяцев (premium)
  recipient_username  TEXT NOT NULL,                       -- Telegram-username получателя, без @

  price_usd           DECIMAL(10, 2) NOT NULL CHECK (price_usd > 0),  -- базовая цена пакета, USD
  price_rub           DECIMAL(10, 2) NOT NULL CHECK (price_rub >= 0), -- списано с пользователя, ₽

  status              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'completed', 'failed')),

  idempotency_key     TEXT UNIQUE,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_orders_user    ON telegram_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_orders_status  ON telegram_orders(status);
CREATE INDEX IF NOT EXISTS idx_telegram_orders_created ON telegram_orders(created_at DESC);

-- RLS: пользователь видит ТОЛЬКО свои заказы. Запись — только через service-role.
ALTER TABLE telegram_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_orders_select_own ON telegram_orders;
CREATE POLICY telegram_orders_select_own ON telegram_orders
  FOR SELECT USING (auth.uid() = user_id);

-- Триггер обновления updated_at.
CREATE OR REPLACE FUNCTION set_telegram_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telegram_orders_updated_at ON telegram_orders;
CREATE TRIGGER telegram_orders_updated_at BEFORE UPDATE ON telegram_orders
  FOR EACH ROW EXECUTE FUNCTION set_telegram_orders_updated_at();

-- Перезагрузка schema cache PostgREST (после DDL).
NOTIFY pgrst, 'reload schema';
