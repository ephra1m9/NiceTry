// Боевой клиент платёжной системы pay4game (https://pay4game.ru).
//
// Документация: pay4game_API.pdf (раздел «Журнал» в WORKLOG_PAY4GAME.md). Здесь — низкоуровневые
// обёртки эндпоинтов + подписи. Ключи берутся ТОЛЬКО из env (fail-fast при отсутствии в live).
//
// БЕЗОПАСНОСТЬ ПОДПИСЕЙ:
//   signPay4game(data) = HMAC-SHA256(SECRET_KEY, data) → hex.
//   payment/create: data = "{invoice_id}:{amount}:{email}".
//   payout/create (sbp):  "{invoice_id}:{amount}:{phone}".
//   payout/create (card): "{invoice_id}:{amount}:{card_number}".
//   Вебхук: HMAC по СЫРОМУ телу запроса, сравнение с X-REQUEST-SIGNATURE за постоянное время.
//
// ФОРМАТ СУММЫ: всегда строка с 2 знаками (amount.toFixed(2)). Один и тот же формат идёт И в
// подпись, И в параметр amount — иначе подпись не сойдётся на стороне pay4game.

import { createHmac, timingSafeEqual } from 'crypto'

// ——————————————————————————————————————————————————————————————————————
// Конфигурация (env)
// ——————————————————————————————————————————————————————————————————————

export interface Pay4gameConfig {
  apiBase: string
  apiToken: string
  secretKey: string
  projectId: string
  defaultMethod: string
  sbpType: 'qr' | 'url'
  returnUrl: string
}

/** Базовый адрес API без завершающего слэша (по умолчанию боевой). */
function apiBase(): string {
  return (process.env.PAY4GAME_API_BASE || 'https://pay4game.ru/api').replace(/\/+$/, '')
}

/**
 * Прочитать конфиг pay4game из env. Кидает понятную ошибку, если в live не заданы ключи
 * (fail-fast: лучше явная 500 при старте платежа, чем «тихая» отправка без подписи).
 */
export function getPay4gameConfig(): Pay4gameConfig {
  const apiToken = process.env.PAY4GAME_API_TOKEN || ''
  const secretKey = process.env.PAY4GAME_SECRET_KEY || ''
  const projectId = process.env.PAY4GAME_PROJECT_ID || ''
  const missing: string[] = []
  if (!apiToken) missing.push('PAY4GAME_API_TOKEN')
  if (!secretKey) missing.push('PAY4GAME_SECRET_KEY')
  if (missing.length) {
    throw new Error(
      `pay4game не сконфигурирован: не заданы ${missing.join(', ')}. ` +
        'Задайте их в env (.env.local / Vercel) или используйте PAYMENTS_MODE=mock.'
    )
  }
  const sbpType = process.env.PAY4GAME_SBP_TYPE === 'url' ? 'url' : 'qr'
  return {
    apiBase: apiBase(),
    apiToken,
    secretKey,
    projectId,
    defaultMethod: process.env.PAY4GAME_DEFAULT_METHOD || 'sbp',
    sbpType,
    returnUrl: process.env.PAY4GAME_RETURN_URL || '',
  }
}

/** Сумма к строке с 2 знаками (единый формат для подписи и параметра amount). */
export function formatAmount(amount: number): string {
  return Number(amount).toFixed(2)
}

// ——————————————————————————————————————————————————————————————————————
// Подписи
// ——————————————————————————————————————————————————————————————————————

/** HMAC-SHA256(secretKey, data) → hex. */
export function signPay4game(data: string, secretKey: string): string {
  return createHmac('sha256', secretKey).update(data).digest('hex')
}

/** Подпись payment/create: "{invoice_id}:{amount}:{email}". amount — уже отформатированная строка. */
export function signPaymentCreate(invoiceId: string, amount: string, email: string, secretKey: string): string {
  return signPay4game(`${invoiceId}:${amount}:${email}`, secretKey)
}

/** Подпись payout/create (sbp): "{invoice_id}:{amount}:{phone}". */
export function signPayoutSbp(invoiceId: string, amount: string, phone: string, secretKey: string): string {
  return signPay4game(`${invoiceId}:${amount}:${phone}`, secretKey)
}

/** Подпись payout/create (card): "{invoice_id}:{amount}:{card_number}". */
export function signPayoutCard(invoiceId: string, amount: string, cardNumber: string, secretKey: string): string {
  return signPay4game(`${invoiceId}:${amount}:${cardNumber}`, secretKey)
}

/**
 * Проверка подписи вебхука. data — СЫРОЕ тело запроса (до JSON.parse). Сравнение constant-time.
 * provided — значение заголовка X-REQUEST-SIGNATURE (hex).
 */
export function verifyWebhookSignature(rawBody: string, provided: string | null, secretKey: string): boolean {
  if (!provided) return false
  const expected = signPay4game(rawBody, secretKey)
  // Подписи — hex одинаковой длины при совпадении. Сравниваем побайтово за постоянное время.
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided.trim(), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ——————————————————————————————————————————————————————————————————————
// HTTP
// ——————————————————————————————————————————————————————————————————————

export class Pay4gameError extends Error {
  constructor(
    public httpStatus: number,
    message: string,
    public payload?: unknown
  ) {
    super(message)
    this.name = 'Pay4gameError'
  }
}

function buildHeaders(cfg: Pay4gameConfig, signature?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (signature) h['X-REQUEST-SIGNATURE'] = signature
  if (cfg.projectId) h['X-REQUEST-PROJECT'] = cfg.projectId
  return h
}

/**
 * POST к pay4game. Параметры по доке идут query-string. При 422 (ошибка входных данных)
 * пробуем повтор с тем же набором параметров в JSON-теле (некоторые инсталляции ждут body).
 * `version` — 'v1' | 'v2'.
 */
async function post(
  cfg: Pay4gameConfig,
  version: 'v1' | 'v2',
  path: string,
  params: Record<string, string | number | undefined>,
  signature?: string
): Promise<unknown> {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') clean[k] = String(v)
  }
  const qs = new URLSearchParams(clean).toString()
  const base = `${cfg.apiBase}/${version}/${path}`
  const headers = buildHeaders(cfg, signature)

  const doFetch = async (url: string, body?: string): Promise<Response> =>
    fetch(url, { method: 'POST', headers, body, cache: 'no-store' })

  // 1) query-string (как в curl-примерах доки)
  let res = await doFetch(qs ? `${base}?${qs}` : base)
  if (res.status === 422) {
    // 2) fallback: те же параметры в JSON-теле
    res = await doFetch(base, JSON.stringify(clean))
  }

  const text = await res.text()
  let json: unknown = undefined
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  if (!res.ok) {
    const fromBody =
      json && typeof json === 'object' && 'message' in json
        ? String((json as { message: unknown }).message)
        : ''
    const msg = fromBody || `pay4game ${path} → HTTP ${res.status}`
    throw new Pay4gameError(res.status, msg, json)
  }
  return json
}

// ——————————————————————————————————————————————————————————————————————
// Эндпоинты v1: платежи / статус / выплаты
// ——————————————————————————————————————————————————————————————————————

export interface PaymentCreateInput {
  invoiceId: string
  amount: number
  email: string
  /** sbp|card|sberpay|tpay|cardkz|carduz|uzum. По умолчанию из конфига. */
  method?: string
  /** qr|url. По умолчанию из конфига (для sbp). */
  sbpType?: 'qr' | 'url'
  clientIp?: string
  returnUrl?: string
  steamAccount?: string
  steamAmount?: number
  /** Уровень риска антифрода pay4game: 1 (низкий) … 5 (высокий). По умолчанию шлём 5. */
  risk?: 1 | 2 | 3 | 4 | 5
  description?: string
}

export interface PaymentCreateResponse {
  success: boolean
  uuid: string
  url: string
  agent_transaction_id?: string
}

/** POST /v1/payment/create. */
export async function paymentCreate(input: PaymentCreateInput, cfg = getPay4gameConfig()): Promise<PaymentCreateResponse> {
  const method = input.method || cfg.defaultMethod
  const amount = formatAmount(input.amount)
  const signature = signPaymentCreate(input.invoiceId, amount, input.email, cfg.secretKey)
  const sbpType = method === 'sbp' ? input.sbpType || cfg.sbpType : undefined
  // client_ip нужен ТОЛЬКО для sbp+qr (по доке «при sbp_type=qr — да»). Для url/card/sberpay
  // хостовая страница оплаты сама определяет устройство по живому соединению; пин client_ip,
  // снятый на серверной функции (x-forwarded-for), там лишь приводит к рассинхрону IP и ошибке
  // «счёт создан для другого устройства». Поэтому для не-qr флоу IP не передаём.
  const clientIp = sbpType === 'qr' ? input.clientIp : undefined
  // return_url: подставляем invoice_id вместо макроса, если задан шаблон c #invoice_id#.
  const returnUrl = (input.returnUrl ?? cfg.returnUrl)?.replace(/#invoice_id#/g, input.invoiceId) || undefined

  const json = (await post(
    cfg,
    'v1',
    'payment/create',
    {
      method,
      sbp_type: sbpType,
      invoice_id: input.invoiceId,
      amount,
      email: input.email,
      client_ip: clientIp,
      return_url: returnUrl,
      steam_account: input.steamAccount,
      steam_amount: input.steamAmount !== undefined ? formatAmount(input.steamAmount) : undefined,
      risk: input.risk,
      description: input.description,
    },
    signature
  )) as PaymentCreateResponse
  return json
}

export interface PaymentStatusResponse {
  invoice_id: string
  uuid: string
  amount: string
  status: 'pending' | 'success' | 'declined' | 'refunded'
  hold: number
  agent_transaction_id?: string
  steam_status?: string
  steam_account?: string
  steam_amount?: string
  signature: string
}

/** POST /v1/payment/status — fallback-поллинг (если вебхук задержался). */
export async function paymentStatus(invoiceId: string, cfg = getPay4gameConfig()): Promise<PaymentStatusResponse> {
  return (await post(cfg, 'v1', 'payment/status', { invoice_id: invoiceId })) as PaymentStatusResponse
}

export interface PayoutSbpInput {
  invoiceId: string
  amount: number
  phone: string
  bankId: string
}
export interface PayoutCardInput {
  invoiceId: string
  amount: number
  cardNumber: string
  fullName: string
}
export interface PayoutResponse {
  success: boolean
  message: string
}

/** POST /v1/payout/create (sbp). Результат — вебхук status_payoff. */
export async function payoutCreateSbp(input: PayoutSbpInput, cfg = getPay4gameConfig()): Promise<PayoutResponse> {
  const amount = formatAmount(input.amount)
  const signature = signPayoutSbp(input.invoiceId, amount, input.phone, cfg.secretKey)
  return (await post(
    cfg,
    'v1',
    'payout/create',
    { method: 'sbp', invoice_id: input.invoiceId, amount, phone: input.phone, bank_id: input.bankId },
    signature
  )) as PayoutResponse
}

/** POST /v1/payout/create (card). Результат — вебхук status_payoff. */
export async function payoutCreateCard(input: PayoutCardInput, cfg = getPay4gameConfig()): Promise<PayoutResponse> {
  const amount = formatAmount(input.amount)
  const signature = signPayoutCard(input.invoiceId, amount, input.cardNumber, cfg.secretKey)
  return (await post(
    cfg,
    'v1',
    'payout/create',
    { method: 'card', invoice_id: input.invoiceId, amount, card_number: input.cardNumber, full_name: input.fullName },
    signature
  )) as PayoutResponse
}

/** Список банков СБП для выплат: GET-подобный POST /v1/payout/fps/banks. */
export async function payoutBanks(cfg = getPay4gameConfig()): Promise<unknown> {
  return post(cfg, 'v1', 'payout/fps/banks', {})
}

// ——————————————————————————————————————————————————————————————————————
// Эндпоинты v2: пополнение Steam (агентские проверки/баланс)
// ——————————————————————————————————————————————————————————————————————

export interface SteamTopupCheckResponse {
  account: string
  amount: string | number
  status: number
}
export interface SteamTopupCheckPayResponse {
  message: string
  status: number
  agent_transaction_id: string
}

/** POST /v2/steam/topup/check — проверка возможности пополнения. */
export async function steamTopupCheck(
  account: string,
  amount: number,
  invoiceId?: string,
  cfg = getPay4gameConfig()
): Promise<SteamTopupCheckResponse> {
  return (await post(cfg, 'v2', 'steam/topup/check', {
    account,
    amount: formatAmount(amount),
    invoice_id: invoiceId,
  })) as SteamTopupCheckResponse
}

/**
 * POST /v2/steam/topup/check_pay — реальная транзакция. ВНИМАНИЕ: при HTTP 500 запрос НЕ повторять
 * (см. доку). Результат — вебхук status_topup.
 */
export async function steamTopupCheckPay(
  account: string,
  amount: number,
  invoiceId?: string,
  cfg = getPay4gameConfig()
): Promise<SteamTopupCheckPayResponse> {
  return (await post(cfg, 'v2', 'steam/topup/check_pay', {
    account,
    amount: formatAmount(amount),
    invoice_id: invoiceId,
  })) as SteamTopupCheckPayResponse
}

/** POST /v2/steam/topup/get_status — статус по agent_transaction_id. */
export async function steamTopupGetStatus(
  agentTransactionId: string,
  invoiceId?: string,
  cfg = getPay4gameConfig()
): Promise<unknown> {
  return post(cfg, 'v2', 'steam/topup/get_status', {
    agent_transaction_id: agentTransactionId,
    invoice_id: invoiceId,
  })
}

/** POST /v2/steam/topup/balance — баланс агента. */
export async function steamTopupBalance(cfg = getPay4gameConfig()): Promise<{ balance: number }> {
  return (await post(cfg, 'v2', 'steam/topup/balance', {})) as { balance: number }
}
