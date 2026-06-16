-- Добавляем price_usd (цена поставщика в USD) для пересчёта при смене наценки/курса.
-- NULL = цена задана вручную в админке (не пересчитывается при смене наценки категории).
-- Заполняется при синке AppRoute/Dessly; товары с price_usd > 0 — автоценные.

ALTER TABLE products ADD COLUMN IF NOT EXISTS price_usd DECIMAL(10, 4) DEFAULT NULL;
