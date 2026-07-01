-- Раздел «Автоматический донат в игры»: витрина игровых пополнений через AppRoute DTU.
-- Архитектура аналогична esim_settings/telegram_settings: данные не лежат в общем каталоге
-- продуктов, т.к. деноминации приходят от AppRoute и кешируются отдельно.

CREATE TABLE IF NOT EXISTS game_topup_games (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 TEXT UNIQUE NOT NULL,
  name                 TEXT NOT NULL,
  image_url            TEXT,
  -- AppRoute DTU service ID. Для игр с одним регионом — строка, для мультирегиональных
  -- (напр. PUBG Mobile CIS/Global) — null (используется approute_service_ids).
  approute_service_id  TEXT,
  -- JSON-карта регион → service_id для мультирегиональных игр: {"cis": "id1", "global": "id2"}
  approute_service_ids JSONB,
  markup_percent       DECIMAL(5,2)  NOT NULL DEFAULT 20,
  usd_to_rub_rate      DECIMAL(8,2)  NOT NULL DEFAULT 85,
  -- Определение полей формы аккаунта. Каждый элемент:
  -- { name, label, type: "text"|"select", required: bool, options?: [{value, label}] }
  account_fields       JSONB         NOT NULL DEFAULT '[]'::jsonb,
  is_active            BOOLEAN       NOT NULL DEFAULT true,
  sort_order           INTEGER       NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_topup_denominations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                   UUID         NOT NULL REFERENCES game_topup_games(id) ON DELETE CASCADE,
  approute_denomination_id  TEXT         NOT NULL,
  name                      TEXT         NOT NULL,
  price_usd                 DECIMAL(10,4) NOT NULL,
  -- Кешированная цена в рублях; пересчитывается при изменении markup/rate игры.
  price_rub                 INTEGER      NOT NULL,
  -- Для мультирегиональных игр (напр. PUBG Mobile): "cis" | "global" | null
  region                    TEXT,
  sort_order                INTEGER      NOT NULL DEFAULT 0,
  is_active                 BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE(game_id, approute_denomination_id, region)
);

-- RLS: витрина читается публично, запись только через service-role (админка/синк).
ALTER TABLE game_topup_games        ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_topup_denominations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_topup_games_public_read"
  ON game_topup_games FOR SELECT USING (true);

CREATE POLICY "game_topup_denominations_public_read"
  ON game_topup_denominations FOR SELECT USING (true);

-- Начальный набор игр.
INSERT INTO game_topup_games (slug, name, sort_order, account_fields) VALUES
  (
    'genshin-impact',
    'Genshin Impact',
    1,
    '[
      {"name":"uid","label":"UID","type":"text","required":true,"placeholder":"Ваш UID в игре"},
      {"name":"server","label":"Сервер","type":"select","required":true,
       "options":[
         {"value":"os_usa","label":"America"},
         {"value":"os_euro","label":"Europe"},
         {"value":"os_asia","label":"Asia"},
         {"value":"os_cht","label":"TW/HK/MO"}
       ]}
    ]'::jsonb
  ),
  (
    'pubg-mobile',
    'PUBG Mobile Top Up',
    2,
    '[
      {"name":"player_id","label":"Player ID","type":"text","required":true,"placeholder":"Ваш Player ID"},
      {"name":"region","label":"Регион","type":"select","required":true,
       "options":[
         {"value":"cis","label":"CIS"},
         {"value":"global","label":"Global"}
       ]}
    ]'::jsonb
  ),
  (
    'blood-strike',
    'Blood Strike',
    3,
    '[
      {"name":"user_id","label":"User ID","type":"text","required":true,"placeholder":"Ваш User ID"}
    ]'::jsonb
  ),
  (
    'super-sus',
    'Super Sus',
    4,
    '[
      {"name":"user_id","label":"User ID","type":"text","required":true,"placeholder":"Ваш User ID"}
    ]'::jsonb
  ),
  (
    'delta-force-mobile',
    'Delta Force Mobile',
    5,
    '[
      {"name":"user_id","label":"User ID","type":"text","required":true,"placeholder":"Ваш User ID"}
    ]'::jsonb
  ),
  (
    'free-fire',
    'Free Fire',
    6,
    '[
      {"name":"user_id","label":"User ID","type":"text","required":true,"placeholder":"Ваш User ID"}
    ]'::jsonb
  ),
  (
    'marvel-rivals',
    'Marvel Rivals',
    7,
    '[
      {"name":"user_id","label":"User ID","type":"text","required":true,"placeholder":"Ваш User ID"}
    ]'::jsonb
  ),
  (
    'mobile-legends-ru',
    'Mobile Legends: Bang Bang Russia',
    8,
    '[
      {"name":"user_id","label":"User ID","type":"text","required":true,"placeholder":"Ваш User ID"},
      {"name":"zone_id","label":"Zone ID","type":"text","required":true,"placeholder":"Zone ID сервера"}
    ]'::jsonb
  ),
  (
    'zenless-zone-zero',
    'Zenless Zone Zero',
    9,
    '[
      {"name":"uid","label":"UID","type":"text","required":true,"placeholder":"Ваш UID в игре"},
      {"name":"server","label":"Сервер","type":"select","required":true,
       "options":[
         {"value":"prod_gf_us","label":"America"},
         {"value":"prod_gf_eu","label":"Europe"},
         {"value":"prod_gf_jp","label":"Asia"},
         {"value":"prod_gf_sg","label":"SEA"}
       ]}
    ]'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;
