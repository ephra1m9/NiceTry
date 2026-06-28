// Настройки раздела «Автоматический донат в игры»: список игр и деноминаций.
// Аналог esim-settings.ts, но данные хранятся в двух таблицах (game_topup_games +
// game_topup_denominations), а не в синглтоне.

import { supabaseAdmin } from '@/lib/supabase/admin'

export interface AccountField {
  name: string
  label: string
  type: 'text' | 'select'
  required: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface GameTopupGame {
  id: string
  slug: string
  name: string
  image_url: string | null
  approute_service_id: string | null
  approute_service_ids: Record<string, string> | null
  markup_percent: number
  usd_to_rub_rate: number
  account_fields: AccountField[]
  is_active: boolean
  sort_order: number
}

export interface GameTopupDenomination {
  id: string
  game_id: string
  approute_denomination_id: string
  name: string
  price_usd: number
  price_rub: number
  region: string | null
  sort_order: number
  is_active: boolean
}

/** Все активные игры, отсортированные по sort_order. */
export async function getGameTopupGames(): Promise<GameTopupGame[]> {
  try {
    const { data } = await supabaseAdmin
      .from('game_topup_games')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    return (data ?? []).map(normalizeGame)
  } catch {
    return []
  }
}

/** Все игры (включая неактивные) — для админки. */
export async function getAllGameTopupGames(): Promise<GameTopupGame[]> {
  try {
    const { data } = await supabaseAdmin
      .from('game_topup_games')
      .select('*')
      .order('sort_order', { ascending: true })
    return (data ?? []).map(normalizeGame)
  } catch {
    return []
  }
}

/** Одна активная игра по slug. */
export async function getGameTopupGame(slug: string): Promise<GameTopupGame | null> {
  try {
    const { data } = await supabaseAdmin
      .from('game_topup_games')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()
    return data ? normalizeGame(data) : null
  } catch {
    return null
  }
}

/** Активные деноминации игры, отсортированные по sort_order. */
export async function getGameDenominations(gameId: string): Promise<GameTopupDenomination[]> {
  try {
    const { data } = await supabaseAdmin
      .from('game_topup_denominations')
      .select('*')
      .eq('game_id', gameId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    return (data ?? []).map(normalizeDenomination)
  } catch {
    return []
  }
}

/** Одна деноминация по ID (для серверной валидации цены при заказе). */
export async function getGameDenomination(denominationId: string): Promise<GameTopupDenomination | null> {
  try {
    const { data } = await supabaseAdmin
      .from('game_topup_denominations')
      .select('*')
      .eq('id', denominationId)
      .eq('is_active', true)
      .maybeSingle()
    return data ? normalizeDenomination(data) : null
  } catch {
    return null
  }
}

/** ceil(priceUsd × rate × (1 + markup/100)) — та же формула, что в src/lib/catalog.ts priceRub. */
export function calcPriceRub(priceUsd: number, rate: number, markupPercent: number): number {
  return Math.ceil(priceUsd * rate * (1 + markupPercent / 100))
}

function normalizeGame(row: Record<string, unknown>): GameTopupGame {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    image_url: row.image_url ? String(row.image_url) : null,
    approute_service_id: row.approute_service_id ? String(row.approute_service_id) : null,
    approute_service_ids: (row.approute_service_ids as Record<string, string> | null) ?? null,
    markup_percent: Number(row.markup_percent ?? 20),
    usd_to_rub_rate: Number(row.usd_to_rub_rate ?? 85),
    account_fields: Array.isArray(row.account_fields) ? (row.account_fields as AccountField[]) : [],
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 0),
  }
}

function normalizeDenomination(row: Record<string, unknown>): GameTopupDenomination {
  return {
    id: String(row.id),
    game_id: String(row.game_id),
    approute_denomination_id: String(row.approute_denomination_id),
    name: String(row.name),
    price_usd: Number(row.price_usd),
    price_rub: Number(row.price_rub),
    region: row.region ? String(row.region) : null,
    sort_order: Number(row.sort_order ?? 0),
    is_active: row.is_active !== false,
  }
}
