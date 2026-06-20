-- Миграция: переход выдачи Telegram Stars/Premium с ручной на автоматическую через AppRoute
-- (createDtuOrder, direct_topup). Добавляет колонки для привязки к заказу поставщика —
-- нужны для поддержки/сверки, если заказ застрял в pending.
--
-- Применять через service-role (psql / Supabase SQL editor) ПОСЛЕ 2026-06-21_telegram_orders.sql.
-- Идемпотентна.

ALTER TABLE telegram_orders
  ADD COLUMN IF NOT EXISTS denomination_id   TEXT, -- AppRoute denominationId купленного пакета
  ADD COLUMN IF NOT EXISTS supplier_order_id TEXT; -- AppRoute orderId (для сверки в их кабинете)

NOTIFY pgrst, 'reload schema';
