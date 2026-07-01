-- Удаляет товары Steam Gift Card, сгенерированные из локального мок-каталога
-- (src/data/catalog.json → svc_steam_giftcard), а не полученные от реального AppRoute API.
--
-- Мок задавал один и тот же набор номиналов в USD ($5/$10/$20/$50/$100) и искусственно
-- размножал его на 8 "регионов" (US/AE/TR/VN/EU/IN/HK/ID) без реальных локализованных цен —
-- отсюда доллары в названии товара для региона "Турция" вместо лир. Эти строки попали в
-- products из-за того, что синк при ошибке живого запроса к AppRoute молча подставлял мок
-- вместо реальных данных (см. src/lib/catalog.ts, _doBuildCatalog).
--
-- supplier_service_id = 'svc_steam_giftcard' — литеральный ID из мок-каталога, у реального
-- AppRoute сервисы имеют другой формат ID, поэтому это надёжный признак мок-происхождения.
--
-- Применить через Supabase Dashboard → SQL Editor.
DELETE FROM products
WHERE supplier = 'approute'
  AND supplier_service_id = 'svc_steam_giftcard';
