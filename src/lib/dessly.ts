// Клиент Dessly API (поставщик отправки игр / гифтов в Steam).
// Документация: https://desslyhub.readme.io/ (reference) + БОЕВАЯ ПРОВЕРКА живого сервера (Блок DSL-3).
//
// ⚠️ ВАЖНО: публичная дока УСТАРЕЛА по части авторизации. Она утверждает, что ключ передаётся
// заголовком `apikey: <key>`. Живой сервер https://desslyhub.com это ОТВЕРГАЕТ и требует
// ПОДПИСАННЫЙ запрос (проверено последовательными 401):
//   X-Api-Key:   <публичный ключ>           (32 hex-символа из .env)
//   X-Timestamp: <unix-время>               (см. signRequest)
//   X-Signature: <HMAC-подпись запроса>     (секрет + алгоритм НЕ задокументированы публично)
//
// РЕАЛЬНЫЙ контракт эндпоинтов (сверено по reference, совпало):
//   База:    https://desslyhub.com
//   GET  /api/v1/service/steamgift/games                 — список игр { games: [{ name, appid }] }
//   GET  /api/v1/service/steamgift/games/{app_id}        — издания/регионы игры
//        → { game: [{ edition, package_id, regions_info: [{ region, discount, price, price_original }] }] }
//   POST /api/v1/service/steamgift/sendgames             — покупка/отправка гифта
//        тело: { invite_url, package_id, region, reference? } → { transaction_id, status, error_code }
//   GET  /api/v1/merchants/transaction/{id}/status       — статус транзакции { status } | { error_code }
//   GET  /api/v1/merchants/balance                       — баланс мерчанта { balance: "1.0000" }
//
// Dessly отдаёт ошибки В ТЕЛЕ как { error_code: -N } даже при HTTP 200 (см. liveRequest).
// Статусы: success | pending | failed | cancelled (failed/cancelled → деньги возвращены поставщиком).
//
// Режимы: боевой — только если заданы И DESSLY_API_KEY, И DESSLY_API_SECRET (нужен для подписи);
// иначе мок из catalog.json. Это fail-safe: с одним ключом (без секрета) клиент НЕ бьёт боевыми
// 401 по покупателям, а отдаёт каталог-фолбэк. Форма публичных ответов одинакова в обоих режимах.

import { createHmac } from 'crypto'
import catalog from '@/data/catalog.json'

const DEFAULT_BASE_URL = 'https://desslyhub.com'

const PLACEHOLDER_VALUES = new Set(['', 'your_dessly_api_key', 'your_dessly_api_secret', 'TODO', 'changeme'])

// ============================================================
// Публичные типы
// ============================================================

export interface DesslyGame {
  /** app_id игры в Steam (строкой). */
  id: string
  name: string
  /** Числовой appid из ответа Dessly (для getGame). */
  appid: number
  /** Цена в мок-режиме (из catalog.json). Боевой `games` цену НЕ отдаёт — берётся из getGame по региону. */
  price: number
  currency: string
  platform: string
  inStock: boolean
}

/** Цена издания в конкретном регионе (regions_info[]). */
export interface DesslyRegionPrice {
  region: string
  /** Финальная цена (вкл. скидки/комиссии), как отдаёт Dessly (число). */
  price: number
  /** Цена до скидки. */
  priceOriginal: number
  /** Скидка (как отдаёт Dessly). */
  discount: number
}

/** Издание игры (элемент массива `game[]`). */
export interface DesslyEdition {
  edition: string
  packageId: number
  regions: DesslyRegionPrice[]
}

export type DesslyGiftStatus = 'pending' | 'sent' | 'failed'

export interface DesslyGiftRequest {
  /** Ссылка-приглашение Steam получателя (https://s.team/p/... | steamcommunity.com/p/...). */
  inviteUrl: string
  /** package_id издания (из getGame). */
  packageId: number
  /** Регион аккаунта получателя (RU/KZ/...). */
  region: string
  /** Опциональный идентификатор на нашей стороне (идемпотентность/трекинг). */
  reference?: string
}

export interface DesslyGiftResponse {
  transactionId: string
  status: DesslyGiftStatus
  giftLink?: string
  message?: string
  /** Сырой error_code от Dessly (если был). */
  errorCode?: number
}

// Валидатор ссылки-приглашения Steam вынесен в client-safe модуль (без process.env/catalog),
// чтобы фолбэк-экран отправки игры (клиентский компонент) не тянул серверный клиент в бандл.
export { STEAM_INVITE_RE, isSteamInviteUrl } from './dessly-gift'

// ============================================================
// Конфиг / режим
// ============================================================

function baseUrl(): string {
  return (process.env.DESSLY_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
}
function apiKey(): string {
  return (process.env.DESSLY_API_KEY || '').trim()
}
function apiSecret(): string {
  return (process.env.DESSLY_API_SECRET || '').trim()
}

/**
 * Боевой режим включён, только если заданы валидные (не плейсхолдерные) КЛЮЧ И СЕКРЕТ.
 * Секрет обязателен: живой Dessly требует подпись X-Signature (Блок DSL-3). Без секрета остаёмся
 * в мок-режиме — иначе боевые запросы вернут 401 «invalid signature» прямо покупателям.
 */
export function isLiveMode(): boolean {
  // Форс-мок: герметичность тестов/стейджа даже при реальных ключах в окружении.
  // Боевые HTTP-пути покрываются отдельно стабом global.fetch.
  if (process.env.NICETRY_FORCE_SUPPLIER_MOCK === '1') return false
  const key = apiKey()
  const secret = apiSecret()
  return (
    key.length > 0 &&
    !PLACEHOLDER_VALUES.has(key) &&
    secret.length > 0 &&
    !PLACEHOLDER_VALUES.has(secret)
  )
}

// ============================================================
// Ошибки и коды
// ============================================================

/** Карта error_code → человекочитаемое сообщение (по странице Error Codes). */
const DESSLY_ERROR_MESSAGES: Record<number, string> = {
  [-1]: 'Внутренняя ошибка сервиса Dessly',
  [-2]: 'Недостаточно средств на балансе поставщика',
  [-3]: 'Некорректная сумма',
  [-4]: 'Некорректное тело запроса',
  [-5]: 'Доступ запрещён (проверьте apikey)',
  [-51]: 'Некорректная ссылка для добавления в друзья',
  [-52]: 'Некорректный App ID',
  [-53]: 'Информация об игре не найдена',
  [-54]: 'У получателя нет основной игры',
  [-55]: 'У получателя уже есть эта игра',
  [-56]: 'Не удалось добавить получателя в друзья',
  [-57]: 'Некорректно указан регион покупателя',
  [-58]: 'Регион получателя недоступен для гифта',
  [-59]: 'Пользователь не добавил/удалил бота из списка друзей',
  [-100]: 'Некорректный логин Steam',
  [-120]: 'Некорректное значение валюты',
  [-121]: 'Валюта не поддерживается',
  [-151]: 'Некорректный ID транзакции',
  [-152]: 'Транзакция не найдена',
  [-153]: 'Не указан номер страницы',
  [-200]: 'Мобильная игра не найдена',
  [-201]: 'Позиция мобильной игры не найдена',
  [-202]: 'Источник варианта не найден',
  [-300]: 'Ваучер не найден',
  [-301]: 'Ваучер недоступен',
}

export function desslyErrorMessage(code: number): string {
  return DESSLY_ERROR_MESSAGES[code] || `Ошибка Dessly (код ${code})`
}

export class DesslyError extends Error {
  /** HTTP-статус (или 0 при сетевой ошибке, 502 при ошибке в теле). */
  status: number
  /** Сырой error_code Dessly, если ошибка пришла в теле ответа. */
  code?: number
  constructor(message: string, status: number, code?: number) {
    super(message)
    this.name = 'DesslyError'
    this.status = status
    this.code = code
  }
}

// ============================================================
// Низкоуровневый HTTP (подписанные запросы)
// ============================================================

/**
 * Подпись запроса Dessly (X-Signature).
 *
 * ⚠️ КАНОНИЧЕСКАЯ СТРОКА НЕ ПОДТВЕРЖДЕНА: публичная дока не описывает схему подписи, а перебор
 * стандартных вариантов против живого сервера дал «invalid signature» (Блок DSL-3) — почти
 * наверняка нужен ОТДЕЛЬНЫЙ секрет подписи + точный формат от Dessly. Это ЕДИНСТВЕННОЕ место,
 * которое нужно поправить, когда владелец предоставит спецификацию (см. WORKLOG DSL-3).
 * Текущая формула — наиболее распространённый best-guess: HMAC-SHA256(secret, METHOD+path+timestamp+body) → hex.
 */
function signRequest(method: string, path: string, timestamp: string, body: string): string {
  const canonical = `${method.toUpperCase()}${path}${timestamp}${body}`
  return createHmac('sha256', apiSecret()).update(canonical).digest('hex')
}

async function liveRequest<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}
): Promise<T> {
  const method = opts.method || 'GET'
  let body = ''
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  // Подписанная авторизация Dessly: X-Api-Key + X-Timestamp + X-Signature (имена подтверждены
  // ответами живого сервера; см. WORKLOG DSL-3). НЕ заголовок `apikey` и НЕ Authorization: Bearer.
  const timestamp = Math.floor(Date.now() / 1000).toString()
  headers['X-Api-Key'] = apiKey()
  headers['X-Timestamp'] = timestamp
  headers['X-Signature'] = signRequest(method, path, timestamp, body)

  let res: Response
  try {
    res = await fetch(baseUrl() + path, { method, headers, body: body || undefined, cache: 'no-store' })
  } catch (e) {
    throw new DesslyError(`Network error calling Dessly: ${(e as Error).message}`, 0)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Попробуем достать error_code даже из не-2xx тела.
    let code: number | undefined
    try {
      code = (JSON.parse(text) as { error_code?: number })?.error_code
    } catch {
      /* not json */
    }
    throw new DesslyError(
      code != null ? desslyErrorMessage(code) : `Dessly API error ${res.status}: ${text.slice(0, 200)}`,
      res.status,
      code
    )
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  // КЛЮЧЕВОЕ: Dessly кладёт error_code в тело даже при HTTP 200. error_code < 0 → ошибка.
  const ec = json?.error_code
  if (typeof ec === 'number' && ec < 0) {
    throw new DesslyError(desslyErrorMessage(ec), 502, ec)
  }
  return json as T
}

// ============================================================
// Нормализация / маппинг
// ============================================================

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Маппинг строкового статуса Dessly → наш статус выдачи. */
function mapStatus(s: unknown): DesslyGiftStatus {
  const v = String(s ?? '').toLowerCase()
  if (v === 'success') return 'sent'
  if (v === 'pending') return 'pending'
  // failed, cancelled, неизвестное → провал (деньги у поставщика возвращены).
  return 'failed'
}

// ---- Мок-данные из catalog.json ----

function mockGames(): DesslyGame[] {
  return catalog.desslyGames.map((g) => ({
    id: g.id,
    name: g.name,
    appid: hashToAppid(g.id),
    price: g.price,
    currency: g.currency,
    platform: g.platform,
    inStock: g.inStock,
  }))
}

/** Детерминированный «appid»/«package_id» для мок-режима (стабильный по id игры). */
function hashToAppid(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 9_000_000) + 1_000_000
}

// ============================================================
// Публичные методы
// ============================================================

/** Список игр, доступных для отправки гифтом. GET /api/v1/service/steamgift/games */
export async function listGames(): Promise<DesslyGame[]> {
  if (isLiveMode()) {
    const data = await liveRequest<{ games?: Array<Record<string, unknown>> }>(
      '/api/v1/service/steamgift/games'
    )
    const games = Array.isArray(data.games) ? data.games : []
    return games.map((g) => {
      const appid = toNum(g.appid)
      return {
        id: String(appid || g.appid || ''),
        name: String(g.name ?? ''),
        appid,
        // Боевой `games` цену не отдаёт — она зависит от региона/издания (см. getGame).
        price: 0,
        currency: 'USD',
        platform: 'Steam',
        inStock: true,
      }
    })
  }
  return mockGames()
}

/**
 * Издания и региональные цены игры по app_id.
 * GET /api/v1/service/steamgift/games/{app_id}
 * → { game: [{ edition, package_id, regions_info: [{ region, discount, price, price_original }] }] }
 */
export async function getGame(appId: string | number): Promise<DesslyEdition[]> {
  if (isLiveMode()) {
    const data = await liveRequest<{ game?: Array<Record<string, unknown>> }>(
      `/api/v1/service/steamgift/games/${encodeURIComponent(String(appId))}`
    )
    const editions = Array.isArray(data.game) ? data.game : []
    return editions.map((e) => ({
      edition: String(e.edition ?? ''),
      packageId: toNum(e.package_id),
      regions: (Array.isArray(e.regions_info) ? e.regions_info : []).map(
        (r: Record<string, unknown>) => ({
          region: String(r.region ?? '').toUpperCase(),
          price: toNum(r.price),
          priceOriginal: toNum(r.price_original),
          discount: toNum(r.discount),
        })
      ),
    }))
  }
  // Мок: одно издание со всеми регионами по цене из catalog.json.
  // Резолвим товары каталога и любой id по конвенции dessly_* (так их сидит seed.mjs:
  // denomination_id = id игры вида dessly_<game>). Неизвестный app_id → пусто («игра не найдена»).
  const key = String(appId)
  const g = mockGames().find((x) => x.id === key || x.appid === Number(appId))
  const known = g != null || key.startsWith('dessly_')
  if (!known) return []
  const price = g?.price ?? 19.99
  const regions = ['RU', 'KZ', 'UA', 'TR', 'CN', 'KR', 'ID', 'VN', 'IN'].map((region) => ({
    region,
    price,
    priceOriginal: price,
    discount: 0,
  }))
  return [{ edition: 'Standard', packageId: hashToAppid(key), regions }]
}

/**
 * Разрешает package_id (и цену) для отправки гифта: по app_id игры, региону и (опц.) названию издания.
 * Возвращает null, если издание/регион недоступны. Используется перед sendGift в потоке выдачи.
 */
export async function resolvePackage(
  appId: string | number,
  region: string,
  editionName?: string
): Promise<{ packageId: number; price: number; region: string; edition: string } | null> {
  const editions = await getGame(appId)
  if (!editions.length) return null
  const wantRegion = String(region || '').toUpperCase()
  const wantEdition = (editionName || '').trim().toLowerCase()

  // Выбор издания: по имени (если задано), иначе первое.
  const edition =
    (wantEdition && editions.find((e) => e.edition.toLowerCase() === wantEdition)) || editions[0]
  if (!edition || !edition.packageId) return null

  const rp =
    edition.regions.find((r) => r.region === wantRegion) || (wantRegion ? undefined : edition.regions[0])
  if (!rp) return null

  return { packageId: edition.packageId, price: rp.price, region: rp.region, edition: edition.edition }
}

/**
 * Отправка игры гифтом. POST /api/v1/service/steamgift/sendgames
 * Тело: { invite_url, package_id, region, reference? }.
 */
export async function sendGift(req: DesslyGiftRequest): Promise<DesslyGiftResponse> {
  if (isLiveMode()) {
    const data = await liveRequest<Record<string, unknown>>(
      '/api/v1/service/steamgift/sendgames',
      {
        method: 'POST',
        body: {
          invite_url: req.inviteUrl,
          // OpenAPI Dessly типизирует package_id как string (даже при числовых значениях),
          // а -4 «Incorrect request body» — реальный код ошибки → шлём строкой во избежание отказа.
          package_id: String(req.packageId),
          region: req.region,
          ...(req.reference ? { reference: req.reference } : {}),
        },
      }
    )
    return {
      transactionId: String(data.transaction_id ?? ''),
      status: mapStatus(data.status),
      giftLink: (data.gift_link as string | undefined) ?? undefined,
      message: data.message as string | undefined,
      errorCode: typeof data.error_code === 'number' ? data.error_code : undefined,
    }
  }
  // Мок: гифт «отправлен».
  const ref = req.reference || `pkg${req.packageId}`
  return {
    transactionId: `dessly-${Date.now().toString(36)}`,
    status: 'sent',
    giftLink: `https://store.steampowered.com/gift/mock-${ref}`,
  }
}

/**
 * Статус транзакции. GET /api/v1/merchants/transaction/{transaction_id}/status
 * → { status } | { error_code }.
 */
export async function getTransactionStatus(transactionId: string): Promise<DesslyGiftResponse> {
  if (isLiveMode()) {
    const data = await liveRequest<Record<string, unknown>>(
      `/api/v1/merchants/transaction/${encodeURIComponent(transactionId)}/status`
    )
    return {
      transactionId,
      status: mapStatus(data.status),
      message: data.message as string | undefined,
    }
  }
  return { transactionId, status: 'sent' }
}

/** Баланс мерчанта. GET /api/v1/merchants/balance → { balance: "1.0000" }. */
export async function getMerchantBalance(): Promise<{ balance: number; currency: string }> {
  if (isLiveMode()) {
    const data = await liveRequest<Record<string, unknown>>('/api/v1/merchants/balance')
    return { balance: toNum(data.balance), currency: 'USD' }
  }
  return { balance: 1000, currency: 'USD' }
}
