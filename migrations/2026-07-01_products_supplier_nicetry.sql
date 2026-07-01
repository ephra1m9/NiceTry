-- Добавляем 'nicetry' в список допустимых поставщиков для таблицы products.
-- NiceTry — ручная обработка заказов без API-интеграции.

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_supplier_check;

ALTER TABLE products
  ADD CONSTRAINT products_supplier_check
  CHECK (supplier IN ('approute', 'dessly', 'nicetry'));
