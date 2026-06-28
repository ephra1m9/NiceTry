-- Добавляет категорию «Донат в игры» (auto-games) в таблицу categories.
-- Отображается на главной странице как специальная плитка (ссылка на /auto-games),
-- icon/name редактируются через /admin/categories.
INSERT INTO categories (name, slug, icon, markup_percent, usd_to_rub_rate, supplier, is_active, sort_order, regions)
VALUES ('Донат в игры', 'auto-games', NULL, 0, 0, NULL, true, 100, '{}')
ON CONFLICT (slug) DO NOTHING;
