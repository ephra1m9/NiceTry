// Клиент Dessly API (поставщик отправки игр / гифтов).
// Документация: https://desslyhub.readme.io/reference/introduction
//
// Эндпоинты (по llms.txt, база — /api/v1):
//   GET  /api/v1/steam/games                 — список игр Steam для покупки
//   GET  /api/v1/steam/games/{app_id}        — издания игры по app_id
//   POST /api/v1/steam/gift                  — покупка/отправка игры гифтом
//   POST /api/v1/service/steam/topup/check_login — проверка возможности пополнения по логину
//   POST /api/v1/steam/refill                — пополнение Steam-аккаунта
//   GET  /api/v1/status/{transaction_id}     — статус транзакции
//   PUT  /api/v1/merchants/balance           — баланс мерчанта
//
// Режимы: если задан DESSLY_API_KEY (+ опц. DESSLY_BASE_URL) — боевой режим (Bearer-токен),
// иначе мок из src/data/catalog.json. Форма ответов сохраняется при переключении.
//
// TODO: вставить токен — заполнить DESSLY_API_KEY в .env.local (ключ предоставит заказчик).
//       При необходимости уточнить схему авторизации (Bearer vs X-API-Key) по документации.

import catalog from '@/data/catalog.json'

const DEFAULT_BASE_URL = 'https://api.desslyhub.com' // TODO: уточнить реальный base URL у поставщика

const PLACEHOLDER_VALUES = new Set(['', 'your_dessly_api_key', 'TODO', 'changeme'])

export interface DesslyGame {
  id: string
  name: string
  price: number // USD
  currency: string
  platform: string
  inStock: boolean
}

export interface DesslyGiftRequest {
  gameId: string
  /**
   * Ссылка-приглашение Steam получателя (формат https://s.team/p/...). Именно по ней Dessly
   * отправляет гифт (см. флоу send-gift). Поле названо recipient для обратной совместимости.
   */
  recipient: string
  referenceId: string
  /** Регион аккаунта получателя (RU/CN/KR/ID/VN/IN/...). Опционально — зависит от издания. */
  region?: string
  /** Идентификатор издания игры (sub/edition), если у игры несколько изданий. */
  edition?: string
}

/**
 * Валидация ссылки-приглашения Steam: https://s.team/p/<code> (короткая) или
 * https://steamcommunity.com/p/<code>. Используется фолбэк-экраном отправки игры (Блок B2)
 * и перед боевым sendGift, чтобы не отправлять заведомо некорректную ссылку.
 */
export const STEAM_INVITE_RE = /^https:\/\/(s\.team\/p\/[A-Za-z0-9_-]+|steamcommunity\.com\/p\/[A-Za-z0-9_-]+)(\/[A-Za-z0-9_-]+)?\/?$/

export function isSteamInviteUrl(url: string): boolean {
  return STEAM_INVITE_RE.test((url || '').trim())
}

export interface DesslyGiftResponse {
  transactionId: string
  status: 'pending' | 'sent' | 'failed'
  giftLink?: string
  message?: string
}

function baseUrl(): string {
  return (process.env.DESSLY_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
}
function apiKey(): string {
  return (process.env.DESSLY_API_KEY || '').trim()
}

/** Боевой режим включён, только если задан валидный (не плейсхолдерный) ключ. */
export function isLiveMode(): boolean {
  // Форс-мок: герметичность тестов/стейджа даже при реальном ключе в окружении.
  // Боевые HTTP-пути покрываются отдельно стабом global.fetch.
  if (process.env.NICETRY_FORCE_SUPPLIER_MOCK === '1') return false
  const key = apiKey()
  return !PLACEHOLDER_VALUES.has(key) && key.length > 0
}

export class DesslyError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'DesslyError'
    this.status = status
  }
}

async function liveRequest<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}
): Promise<T> {
  const method = opts.method || 'GET'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    Accept: 'application/json',
  }
  let body: string | undefined
  if (opts.body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(baseUrl() + path, { method, headers, body, cache: 'no-store' })
  } catch (e) {
    throw new DesslyError(`Network error calling Dessly: ${(e as Error).message}`, 0)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new DesslyError(`Dessly API error ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
  return (await res.json()) as T
}

// ---- Мок-данные из catalog.json ----

function mockGames(): DesslyGame[] {
  return catalog.desslyGames.map((g) => ({
    id: g.id,
    name: g.name,
    price: g.price,
    currency: g.currency,
    platform: g.platform,
    inStock: g.inStock,
  }))
}

// ============================================================
// Публичные методы
// ============================================================

/** Список игр, доступных для отправки гифтом. */
export async function listGames(): Promise<DesslyGame[]> {
  if (isLiveMode()) {
    // Боевой ответ нормализуется к DesslyGame[]; уточнить маппинг полей по факту получения ключа.
    const data = await liveRequest<{ items?: unknown[] }>('/api/v1/steam/games')
    const items = (data.items ?? (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>
    return items.map((g) => ({
      id: String(g.id ?? g.app_id ?? ''),
      name: String(g.name ?? ''),
      price: Number(g.price ?? 0),
      currency: String(g.currency ?? 'USD'),
      platform: String(g.platform ?? 'Steam'),
      inStock: g.inStock !== false,
    }))
  }
  return mockGames()
}

export async function getGame(id: string): Promise<DesslyGame | null> {
  if (isLiveMode()) {
    const g = await liveRequest<Record<string, unknown>>(`/api/v1/steam/games/${encodeURIComponent(id)}`)
    if (!g) return null
    return {
      id: String(g.id ?? g.app_id ?? id),
      name: String(g.name ?? ''),
      price: Number(g.price ?? 0),
      currency: String(g.currency ?? 'USD'),
      platform: String(g.platform ?? 'Steam'),
      inStock: g.inStock !== false,
    }
  }
  return mockGames().find((g) => g.id === id) ?? null
}

/** Отправка игры гифтом (POST /api/v1/steam/gift). */
export async function sendGift(req: DesslyGiftRequest): Promise<DesslyGiftResponse> {
  if (isLiveMode()) {
    // TODO: подтвердить точные имена полей по боевой доке Dessly при получении доступа
    // (region/edition/sub_id могут называться иначе). Базовые app_id/steam invite/reference_id — по llms.txt.
    const data = await liveRequest<Record<string, unknown>>('/api/v1/steam/gift', {
      method: 'POST',
      body: {
        app_id: req.gameId,
        recipient: req.recipient, // Steam Invite URL
        reference_id: req.referenceId,
        ...(req.region ? { region: req.region } : {}),
        ...(req.edition ? { sub_id: req.edition } : {}),
      },
    })
    return {
      transactionId: String(data.transaction_id ?? data.transactionId ?? ''),
      status: (data.status as DesslyGiftResponse['status']) ?? 'pending',
      giftLink: data.gift_link as string | undefined,
      message: data.message as string | undefined,
    }
  }
  // Мок: гифт «отправлен».
  return {
    transactionId: `dessly-${Date.now().toString(36)}`,
    status: 'sent',
    giftLink: `https://store.steampowered.com/gift/mock-${req.referenceId}`,
  }
}

/** Статус транзакции (GET /api/v1/status/{transaction_id}). */
export async function getTransactionStatus(transactionId: string): Promise<DesslyGiftResponse> {
  if (isLiveMode()) {
    const data = await liveRequest<Record<string, unknown>>(
      `/api/v1/status/${encodeURIComponent(transactionId)}`
    )
    return {
      transactionId,
      status: (data.status as DesslyGiftResponse['status']) ?? 'pending',
      giftLink: data.gift_link as string | undefined,
      message: data.message as string | undefined,
    }
  }
  return { transactionId, status: 'sent' }
}

/** Баланс мерчанта (PUT /api/v1/merchants/balance). */
export async function getMerchantBalance(): Promise<{ balance: number; currency: string }> {
  if (isLiveMode()) {
    const data = await liveRequest<Record<string, unknown>>('/api/v1/merchants/balance', {
      method: 'PUT',
    })
    return { balance: Number(data.balance ?? 0), currency: String(data.currency ?? 'USD') }
  }
  return { balance: 1000, currency: 'USD' }
}
