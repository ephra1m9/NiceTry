-- Схема БД для NiceTry (Supabase PostgreSQL)
-- Этап 2: Бэкенд-каркас и авторизация

-- ============================================
-- 1. СТАТУСЫ ПОЛЬЗОВАТЕЛЕЙ (создаём первыми!)
-- ============================================

CREATE TABLE user_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  min_spent DECIMAL(10, 2) DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Стартовые статусы
INSERT INTO user_statuses (name, discount_percent, min_spent, sort_order) VALUES
  ('Bronze', 0, 0, 1),
  ('Silver', 5, 5000, 2),
  ('Gold', 8, 10000, 3);

-- ============================================
-- 2. ПОЛЬЗОВАТЕЛИ
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  telegram_id BIGINT UNIQUE,
  telegram_username TEXT,
  balance DECIMAL(10, 2) DEFAULT 0 CHECK (balance >= 0),
  status_id UUID REFERENCES user_statuses(id),
  referral_code TEXT UNIQUE NOT NULL,
  referred_by UUID REFERENCES users(id),
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_referral_code ON users(referral_code);

-- ============================================
-- 3. КАТЕГОРИИ
-- ============================================

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT,
  markup_percent DECIMAL(5, 2) DEFAULT 14 CHECK (markup_percent >= 0),
  usd_to_rub_rate DECIMAL(8, 2) DEFAULT 80,
  supplier TEXT CHECK (supplier IN ('approute', 'dessly')),
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_slug ON categories(slug);
CREATE INDEX idx_categories_active ON categories(is_active);

-- ============================================
-- 4. ТОВАРЫ
-- ============================================

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('instant', 'topup_auto', 'topup_manual', 'manual')),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  original_price DECIMAL(10, 2),
  stock INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  supplier TEXT CHECK (supplier IN ('approute', 'dessly')),
  supplier_service_id TEXT,
  denomination_id TEXT,
  supplier_fields JSONB,
  min_amount DECIMAL(10, 2),
  max_amount DECIMAL(10, 2),
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_type ON products(type);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_products_supplier ON products(supplier, supplier_service_id);

-- ============================================
-- 5. ПРОМОКОДЫ (создаём ДО orders!)
-- ============================================

CREATE TABLE promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DECIMAL(10, 2) NOT NULL CHECK (discount_value > 0),
  max_uses INTEGER,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promo_codes_code ON promo_codes(code);
CREATE INDEX idx_promo_codes_active ON promo_codes(is_active);

-- ============================================
-- 6. ЗАКАЗЫ
-- ============================================

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  discount_amount DECIMAL(10, 2) DEFAULT 0,
  final_amount DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'paid', 'delivered', 'cancelled')),
  payment_method TEXT CHECK (payment_method IN ('balance', 'card', 'crypto')),
  promo_code_id UUID REFERENCES promo_codes(id),
  delivery_data JSONB,
  supplier_order_id TEXT,
  supplier_reference_id TEXT UNIQUE,
  supplier_trace_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_supplier_ref ON orders(supplier_reference_id);

-- ============================================
-- 7. ПОЗИЦИИ ЗАКАЗА
-- ============================================

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  price DECIMAL(10, 2) NOT NULL,
  voucher_code TEXT,
  delivery_status TEXT CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================
-- 8. ФАЙЛОВЫЕ ТОВАРЫ (для моментальной выдачи)
-- ============================================

CREATE TABLE product_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  key_value TEXT NOT NULL,
  is_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES users(id),
  order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_product_keys_product ON product_keys(product_id);
CREATE INDEX idx_product_keys_available ON product_keys(product_id, is_used) WHERE is_used = FALSE;

-- ============================================
-- 9. ТРАНЗАКЦИИ БАЛАНСА
-- ============================================

CREATE TABLE balance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup', 'purchase', 'refund', 'referral', 'admin')),
  description TEXT,
  order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_balance_transactions_user ON balance_transactions(user_id);
CREATE INDEX idx_balance_transactions_type ON balance_transactions(type);

-- ============================================
-- 10. РЕФЕРАЛЬНАЯ ПРОГРАММА
-- ============================================

CREATE TABLE referral_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type TEXT UNIQUE NOT NULL CHECK (product_type IN ('instant', 'topup_auto', 'topup_manual', 'manual')),
  percent DECIMAL(5, 2) DEFAULT 12 CHECK (percent >= 0 AND percent <= 100),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Стартовые значения
INSERT INTO referral_settings (product_type, percent) VALUES
  ('instant', 12),
  ('topup_auto', 15),
  ('topup_manual', 10),
  ('manual', 10);

CREATE TABLE referral_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_earnings_referrer ON referral_earnings(referrer_id);

-- ============================================
-- 11. БАННЕРЫ
-- ============================================

CREATE TABLE banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  link_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_banners_active ON banners(is_active, sort_order);

-- ============================================
-- 12. UTM-МЕТКИ
-- ============================================

CREATE TABLE utm_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  utm_source TEXT NOT NULL,
  utm_medium TEXT,
  utm_campaign TEXT,
  site_link TEXT NOT NULL,
  bot_link TEXT NOT NULL,
  clicks_count INTEGER DEFAULT 0,
  registrations_count INTEGER DEFAULT 0,
  revenue DECIMAL(10, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE utm_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES utm_campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_utm_clicks_campaign ON utm_clicks(campaign_id);

-- ============================================
-- 13. РАССЫЛКИ
-- ============================================

CREATE TABLE mailings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  button_text TEXT,
  button_url TEXT,
  segment TEXT CHECK (segment IN ('all', 'with_orders', 'without_orders', 'by_status', 'by_utm')),
  segment_filter JSONB,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'queued', 'sending', 'completed', 'failed')),
  scheduled_at TIMESTAMPTZ,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mailings_status ON mailings(status);

-- ============================================
-- 14. ОТЗЫВЫ
-- ============================================

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  is_published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_order ON reviews(order_id);
CREATE INDEX idx_reviews_published ON reviews(is_published);
-- Один отзыв (и один маркer «review_requested») на заказ. Делает атомарным дедуп запроса
-- отзыва в cron: при гонке (Vercel Cron + ручной вызов) второй INSERT падает с 23505 и пропускается.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_order ON reviews(order_id);

-- ============================================
-- ФУНКЦИИ И ТРИГГЕРЫ
-- ============================================

-- Автообновление updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Генерация номера заказа
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
BEGIN
  RETURN 'NT-' || LPAD(FLOOR(RANDOM() * 999999)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Генерация реферального кода
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  code TEXT;
BEGIN
  code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS (Row Level Security)
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Пользователи видят только свои данные
CREATE POLICY users_select_own ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_update_own ON users
  FOR UPDATE USING (auth.uid() = id);

-- Заказы: пользователи видят только свои
CREATE POLICY orders_select_own ON orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY order_items_select_own ON order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
  );

-- Транзакции баланса: только свои
CREATE POLICY balance_transactions_select_own ON balance_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Реферальные начисления: только свои
CREATE POLICY referral_earnings_select_own ON referral_earnings
  FOR SELECT USING (auth.uid() = referrer_id);

-- Отзывы: пользователи видят опубликованные + свои
CREATE POLICY reviews_select_published ON reviews
  FOR SELECT USING (is_published = TRUE OR auth.uid() = user_id);

-- ============================================
-- ПРОКСИ px6 (proxy6) — см. migrations/2026-06-04_proxy_orders.sql (источник истины)
-- ============================================

CREATE TABLE IF NOT EXISTS proxy_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  version         INTEGER NOT NULL CHECK (version IN (3, 4, 5, 6)),
  country         TEXT NOT NULL,
  count           INTEGER NOT NULL CHECK (count > 0),
  period          INTEGER NOT NULL CHECK (period > 0),
  proxy_type      TEXT,
  price_internal  DECIMAL(10, 2) NOT NULL CHECK (price_internal >= 0),
  px6_price       DECIMAL(12, 4),
  px6_currency    TEXT CHECK (px6_currency IN ('RUB', 'USD')),
  px6_order_id    TEXT,
  proxies         JSONB,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proxy_orders_user    ON proxy_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_proxy_orders_status  ON proxy_orders(status);
CREATE INDEX IF NOT EXISTS idx_proxy_orders_created ON proxy_orders(created_at DESC);
ALTER TABLE proxy_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proxy_orders_select_own ON proxy_orders;
CREATE POLICY proxy_orders_select_own ON proxy_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS proxy_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  markup_percent  DECIMAL(5, 2) NOT NULL DEFAULT 30 CHECK (markup_percent >= 0),
  usd_to_rub_rate DECIMAL(8, 2) NOT NULL DEFAULT 100 CHECK (usd_to_rub_rate > 0),
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_periods INTEGER[] NOT NULL DEFAULT ARRAY[7, 14, 30, 90],
  max_count       INTEGER NOT NULL DEFAULT 50 CHECK (max_count > 0),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO proxy_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE proxy_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proxy_settings_public_read ON proxy_settings;
CREATE POLICY proxy_settings_public_read ON proxy_settings
  FOR SELECT USING (TRUE);

CREATE TABLE IF NOT EXISTS telegram_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  markup_percent  DECIMAL(5, 2) NOT NULL DEFAULT 30 CHECK (markup_percent >= 0),
  usd_to_rub_rate DECIMAL(8, 2) NOT NULL DEFAULT 100 CHECK (usd_to_rub_rate > 0),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE telegram_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telegram_settings_public_read ON telegram_settings;
CREATE POLICY telegram_settings_public_read ON telegram_settings
  FOR SELECT USING (TRUE);

CREATE TABLE IF NOT EXISTS telegram_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  product_type        TEXT NOT NULL CHECK (product_type IN ('stars', 'premium')),
  amount              INTEGER NOT NULL CHECK (amount > 0),
  recipient_username  TEXT NOT NULL,
  price_usd           DECIMAL(10, 2) NOT NULL CHECK (price_usd > 0),
  price_rub           DECIMAL(10, 2) NOT NULL CHECK (price_rub >= 0),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  idempotency_key     TEXT UNIQUE,
  denomination_id     TEXT,
  supplier_order_id   TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telegram_orders_user    ON telegram_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_orders_status  ON telegram_orders(status);
CREATE INDEX IF NOT EXISTS idx_telegram_orders_created ON telegram_orders(created_at DESC);
ALTER TABLE telegram_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telegram_orders_select_own ON telegram_orders;
CREATE POLICY telegram_orders_select_own ON telegram_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS telegram_packages (
  id           TEXT PRIMARY KEY,
  product_type TEXT NOT NULL CHECK (product_type IN ('stars', 'premium')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  label        TEXT NOT NULL,
  price_usd    DECIMAL(10, 4) NOT NULL CHECK (price_usd > 0),
  service_id   TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telegram_packages_type ON telegram_packages(product_type, sort_order);
ALTER TABLE telegram_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telegram_packages_public_read ON telegram_packages;
CREATE POLICY telegram_packages_public_read ON telegram_packages
  FOR SELECT USING (TRUE);

-- ============================================
-- 15. ЧАТЫ ПО ЗАКАЗАМ
-- ============================================
-- Один чат на заказ. Авто-выданные позиции (instant/Dessly) приходят туда системным
-- сообщением с кодом; позиции, требующие ручной выдачи, закрывает админ текстом в чате.

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

-- ============================================
-- КОММЕНТАРИИ
-- ============================================

COMMENT ON TABLE users IS 'Пользователи магазина';
COMMENT ON TABLE products IS 'Каталог товаров (4 типа: instant, topup_auto, topup_manual, manual)';
COMMENT ON TABLE orders IS 'Заказы пользователей';
COMMENT ON TABLE promo_codes IS 'Промокоды (процент или фикс)';
COMMENT ON TABLE balance_transactions IS 'История операций с балансом';
COMMENT ON TABLE referral_settings IS 'Настройки реферальной программы по типам товаров';
COMMENT ON TABLE order_chats IS 'Чат покупатель↔продавец по заказу (один чат на заказ)';
COMMENT ON TABLE chat_messages IS 'Сообщения в чате заказа: от покупателя, админа или системные (авто-выдача)';
