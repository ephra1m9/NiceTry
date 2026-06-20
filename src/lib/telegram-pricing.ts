// Ценообразование Telegram Stars / Telegram Premium. Каталог пакетов (id/цена/название)
// синхронизируется из AppRoute кнопкой в админке (POST /api/admin/sync-telegram →
// src/lib/telegram-sync.ts) и хранится в telegram_packages — здесь только читаем готовую
// таблицу, к AppRoute напрямую НЕ обращаемся (раньше каждое открытие модалки после истечения
// кэша тянуло живой каталог поставщика, это было медленно).
//
// Получатель передаётся полем account_reference (паттерн поставщика: @username, t.me/username
// или просто username, 5–32 символа) — см. cleanAccountReference/BARE_USERNAME_RE.

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { TelegramSettings } from '@/types'

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  markup_percent: 30,
  usd_to_rub_rate: 100,
}

export const BARE_USERNAME_RE = /^\w{5,32}$/

/** Срезает @ и https://t.me/ — AppRoute принимает любую из трёх форм, нам проще хранить «голый» username. */
export function cleanAccountReference(raw: string): string {
  return raw.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '')
}

export interface TelegramPackage {
  /** AppRoute denominationId — передаётся в createDtuOrder как есть. */
  id: string
  product_type: 'stars' | 'premium'
  /** Кол-во звёзд (stars) или месяцев подписки (premium). */
  amount: number
  label: string
  /** Цена поставщика, USD, без наценки. */
  price_usd: number
}

export interface TelegramCatalog {
  stars: TelegramPackage[]
  premium: TelegramPackage[]
}

interface PackageRow {
  id: string
  product_type: 'stars' | 'premium'
  amount: number
  label: string
  price_usd: number | string
}

function toPackage(row: PackageRow): TelegramPackage {
  return { id: row.id, product_type: row.product_type, amount: row.amount, label: row.label, price_usd: Number(row.price_usd) }
}

/** Каталог Stars/Premium из БД (telegram_packages) — заполняется синком, не AppRoute напрямую. */
export async function loadTelegramCatalog(): Promise<TelegramCatalog> {
  const { data } = await supabaseAdmin
    .from('telegram_packages')
    .select('id, product_type, amount, label, price_usd')
    .order('sort_order', { ascending: true })

  const rows = (data as PackageRow[] | null) ?? []
  return {
    stars: rows.filter((r) => r.product_type === 'stars').map(toPackage),
    premium: rows.filter((r) => r.product_type === 'premium').map(toPackage),
  }
}

export async function findTelegramPackage(id: string): Promise<TelegramPackage | undefined> {
  const { data } = await supabaseAdmin
    .from('telegram_packages')
    .select('id, product_type, amount, label, price_usd')
    .eq('id', id)
    .maybeSingle()
  return data ? toPackage(data as PackageRow) : undefined
}

/** price_rub = ceil( price_usd × курс × (100 + наценка%) / 100 ), как в proxy-pricing.ts. */
export function telegramPriceRub(priceUsd: number, markupPercent: number, usdToRubRate: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0
  const markup = Number.isFinite(markupPercent) && markupPercent > 0 ? markupPercent : 0
  return Math.ceil((priceUsd * usdToRubRate * (100 + markup)) / 100)
}

/** Настройки Telegram из БД (admin-editable) с фолбэком на дефолты. */
export async function loadTelegramSettings(): Promise<TelegramSettings> {
  try {
    const { data } = await supabaseAdmin
      .from('telegram_settings')
      .select('markup_percent, usd_to_rub_rate')
      .eq('id', 1)
      .maybeSingle()
    if (!data) return { ...DEFAULT_TELEGRAM_SETTINGS }
    return {
      markup_percent: Number(data.markup_percent ?? DEFAULT_TELEGRAM_SETTINGS.markup_percent),
      usd_to_rub_rate: Number(data.usd_to_rub_rate ?? DEFAULT_TELEGRAM_SETTINGS.usd_to_rub_rate),
    }
  } catch {
    return { ...DEFAULT_TELEGRAM_SETTINGS }
  }
}
