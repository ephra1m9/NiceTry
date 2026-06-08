-- Боевая интеграция pay4game: таблицы платежей и лог вебхуков.
--
-- Применить в Supabase → SQL Editor. Идемпотентно (можно прогонять повторно).
-- Связь с заказами: payments.invoice_id = orders.supplier_reference_id (наш UUID-референс заказа).

-- ============================================
-- 1. ПЛАТЕЖИ pay4game
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- invoice_id = наш orderId/референс (orders.supplier_reference_id). Уникален.
  invoice_id      TEXT NOT NULL UNIQUE,
  -- uuid платежа на стороне pay4game.
  uuid            TEXT,
  method          TEXT,                        -- sbp|card|sberpay|tpay|cardkz|carduz|uzum
  amount          DECIMAL(10, 2) NOT NULL,
  -- pending|success|declined|refunded (статусы pay4game).
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'declined', 'refunded', 'error')),
  hold            INTEGER NOT NULL DEFAULT 0,  -- 1 = заблокирован для проверки админом, заказ НЕ выдавать
  email           TEXT,
  qr_content      TEXT,                        -- диплинк QR (из вебхука inform)
  qr_img          TEXT,                        -- QR-картинка base64 (из вебхука inform)
  -- Steam-пополнение (если платёж со steam_account/steam_amount):
  agent_transaction_id TEXT,
  steam_account   TEXT,
  steam_amount    DECIMAL(10, 2),
  steam_status    TEXT,                        -- pending|success|error
  -- payout (выплаты): статус из status_payoff.
  payout_status   TEXT,                        -- pending|success|error|declined
  raw_last_webhook JSONB,                       -- последнее тело вебхука (для разбора)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_uuid    ON payments(uuid);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status);

-- updated_at автообновление (функция update_updated_at_column уже есть в основной схеме).
DROP TRIGGER IF EXISTS payments_updated_at ON payments;
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. ЛОГ ВЕБХУКОВ (идемпотентность + разбор)
-- ============================================
CREATE TABLE IF NOT EXISTS payment_webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,                   -- inform|status|status_steam|status_payoff|status_topup
  invoice_id  TEXT,
  -- статус из тела (для статусных вебхуков) — часть ключа антидубля.
  status      TEXT,
  signature   TEXT,
  body        JSONB,
  processed   BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- Антидубль: один и тот же (type, invoice_id, status) обрабатываем один раз.
-- COALESCE на случай NULL-полей (например, inform без status).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_webhooks_dedupe
  ON payment_webhooks (type, COALESCE(invoice_id, ''), COALESCE(status, ''));

CREATE INDEX IF NOT EXISTS idx_payment_webhooks_invoice ON payment_webhooks(invoice_id);

-- ============================================
-- 3. RLS — таблицы только для service-role (клиент к ним не обращается).
-- ============================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhooks ENABLE ROW LEVEL SECURITY;
-- Без политик: anon/authenticated не имеют доступа; service-role обходит RLS.

-- ============================================
-- 4. orders: разрешить payment_method='card' уже есть. Ничего менять не нужно.
--    Pending-заказ в live создаётся со status='new' (разрешён существующим CHECK).
-- ============================================
