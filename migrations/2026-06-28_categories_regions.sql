-- Добавляет поле regions (массив кодов регионов) к таблице categories.
-- Применить через Supabase Dashboard → SQL Editor.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS regions TEXT[] NOT NULL DEFAULT '{}';
