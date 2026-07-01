-- Разовая чистка "мусорных" image_url, которые до фикса синка AppRoute (2026-07-01)
-- подставлялись как суррогат вместо реальной картинки товара: Google favicon бренда
-- (google.com/s2/favicons?domain=...) или Steam header.jpg по appId
-- (steamstatic.com/store_item_assets/steam/apps/.../header.jpg). Один и тот же значок
-- на все номиналы одного бренда — не индивидуальная картинка товара.
--
-- Синк больше не пишет эти значения и не трогает image_url, если у товара уже что-то
-- стоит — поэтому старый мусор, записанный ДО фикса, сам не уйдёт и продолжает
-- перекрывать collections.default_image_url (products.image_url имеет приоритет).
-- Обнуляем его точечно по паттерну, чтобы не задеть реальные картинки от поставщика
-- или что-либо, загруженное вручную через ImageUploadField.
--
-- Применить через Supabase Dashboard → SQL Editor.
UPDATE products
SET image_url = NULL
WHERE supplier = 'approute'
  AND (
    image_url ILIKE '%google.com/s2/favicons%'
    OR image_url ILIKE '%steamstatic.com/store_item_assets/steam/apps%'
  );
