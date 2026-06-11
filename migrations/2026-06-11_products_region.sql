ALTER TABLE public.products ADD COLUMN IF NOT EXISTS region VARCHAR(10);
CREATE INDEX IF NOT EXISTS products_region_idx ON public.products (region);