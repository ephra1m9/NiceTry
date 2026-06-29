-- Обнуляет image_url у всех товаров.
-- После этого для каждой категории будет работать default_image_url как фолбэк.
-- Применить через Supabase Dashboard → SQL Editor.
UPDATE products SET image_url = NULL;
