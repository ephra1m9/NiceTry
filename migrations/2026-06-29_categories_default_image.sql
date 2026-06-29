-- Добавляет поле default_image_url к таблице categories.
-- Используется как изображение по умолчанию для товаров категории,
-- если у конкретного товара не задан собственный image_url.
-- Применить через Supabase Dashboard → SQL Editor.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS default_image_url TEXT;
