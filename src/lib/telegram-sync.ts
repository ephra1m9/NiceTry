// Живой запрос к AppRoute для двух конкретных сервисов (Telegram Stars / Telegram Premium) —
// вызывается ТОЛЬКО из /api/admin/sync-telegram (кнопка «Синхронизировать» в админке).
// Остальной код (модалка покупки, /api/telegram/buy) читает уже синхронизированную
// таблицу telegram_packages через telegram-pricing.ts и AppRoute не дёргает.
//
// Service id найдены дампом живого каталога /api/v1/services (2026-06-21). Если поставщик
// уберёт/переименует сервисы — синк вернёт 0 пакетов; нужно перепроверить дампом каталога
// и обновить константы ниже.
//
// Берём ТОЛЬКО фикс-пакеты (не custom-quantity варианты — те требуют доп. поле amount).

import { getService } from '@/lib/approute'

export const STARS_SERVICE_ID = '060820eb-992a-4e7f-94b7-e34c4717482d'
export const PREMIUM_SERVICE_ID = '2a668680-eb04-4fd4-b474-a27105160a06'

export interface TelegramPackageRow {
  id: string
  product_type: 'stars' | 'premium'
  amount: number
  label: string
  price_usd: number
  service_id: string
  sort_order: number
}

function parseAmount(name: string): number {
  const m = name.replace(/,/g, '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

/** Тянет живые пакеты Stars/Premium у AppRoute (2 точечных запроса, не весь каталог). */
export async function fetchTelegramPackages(): Promise<TelegramPackageRow[]> {
  const [starsSvc, premiumSvc] = await Promise.all([getService(STARS_SERVICE_ID), getService(PREMIUM_SERVICE_ID)])

  const rows: TelegramPackageRow[] = []
  ;(starsSvc?.items ?? []).forEach((it, i) => {
    const amount = parseAmount(it.name)
    rows.push({ id: it.id, product_type: 'stars', amount, label: `${amount} звёзд`, price_usd: it.price, service_id: STARS_SERVICE_ID, sort_order: i })
  })
  ;(premiumSvc?.items ?? []).forEach((it, i) => {
    const amount = parseAmount(it.name)
    rows.push({ id: it.id, product_type: 'premium', amount, label: `${amount} мес.`, price_usd: it.price, service_id: PREMIUM_SERVICE_ID, sort_order: i })
  })
  return rows
}
