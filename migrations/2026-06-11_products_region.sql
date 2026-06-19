ALTER TABLE public.products ADD COLUMN IF NOT EXISTS region VARCHAR(10);
CREATE INDEX IF NOT EXISTS products_region_idx ON public.products (region);

-- Бэкфилл: заполняем region из суффикса названия вида «... (TR)» для существующих записей.
-- Запускать вручную после применения схемы или через Supabase SQL Editor.
UPDATE public.products
SET region = UPPER(regexp_replace(name, '^.*\(([A-Za-z]{2,3})\)\s*$', '\1'))
WHERE region IS NULL
  AND name ~ '\([A-Za-z]{2,3}\)\s*$';
