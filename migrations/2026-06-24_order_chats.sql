-- Чаты по заказам: после оплаты у заказа появляется чат покупатель↔продавец.
-- Авто-выданные позиции (instant/Dessly) приходят туда системным сообщением с кодом;
-- позиции, которые требуют ручной выдачи (manual/topup_manual/topup_auto без авто-выдачи,
-- провалившиеся instant), закрывает админ текстом прямо в чате.

CREATE TABLE IF NOT EXISTS order_chats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_message_at  TIMESTAMPTZ DEFAULT NOW(),
  last_sender_type TEXT CHECK (last_sender_type IN ('user', 'admin', 'system')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_chats_user ON order_chats(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID NOT NULL REFERENCES order_chats(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin', 'system')),
  sender_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);

ALTER TABLE order_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_chats_select_own ON order_chats;
CREATE POLICY order_chats_select_own ON order_chats
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_messages_select_own ON chat_messages;
CREATE POLICY chat_messages_select_own ON chat_messages
  FOR SELECT USING (chat_id IN (SELECT id FROM order_chats WHERE user_id = auth.uid()));

-- Политик INSERT/UPDATE для anon/authenticated нет: чат создаётся и сообщения пишутся
-- только service-role в серверных роутах (тот же принцип, что у orders/order_items).

COMMENT ON TABLE order_chats IS 'Чат покупатель↔продавец по заказу (один чат на заказ)';
COMMENT ON TABLE chat_messages IS 'Сообщения в чате заказа: от покупателя, админа или системные (авто-выдача)';

NOTIFY pgrst, 'reload schema';
