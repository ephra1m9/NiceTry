// Типы AppRoute Public API v1.
// Источник: AppRoute_Public_API_Documentation_RU.pdf (12 endpoints; scopes: transaction, funds, shop, orders).
// Все суммы у поставщика — в USD, даты — ISO-8601, поля — camelCase.

/**
 * Внутренние коды приложения AppRoute (statusCode).
 * ВАЖНО: statusCode НЕ равен HTTP-статусу — проверять оба (см. PDF, раздел 3).
 */
export enum AppRouteStatusCode {
  OK = 0,
  ACCEPTED = 1, // 202 — заказ принят, выполняется асинхронно
  IDEMPOTENCY_REPLAY = 2, // 200 — повтор по тому же referenceId
  VALIDATION_ERROR = 3, // 422/415
  UNAUTHORIZED = 4, // 401
  FORBIDDEN = 5, // 403
  NOT_FOUND = 6, // 404
  CONFLICT = 7, // 409
  LIMIT_REACHED = 8, // 429 — rate limit
  OUT_OF_STOCK = 9, // 422
  INSUFFICIENT_FUNDS = 10, // 422 — недостаточно средств на балансе магазина
  UPSTREAM_ERROR = 11, // 502
  INTERNAL_ERROR = 12, // 500
}

/** Терминальные и промежуточные статусы заказа (data.status / order.status). */
export type AppRouteOrderStatus =
  | 'IN_PROGRESS'
  | 'SUCCESS'
  | 'PARTIALLY_COMPLETED'
  | 'CANCELLED'

export interface AppRouteFieldError {
  field: string
  code: string
  message: string
}

/** Единый envelope ответа (см. PDF, раздел 3). */
export interface AppRouteEnvelope<T = unknown> {
  status: string
  statusCode: AppRouteStatusCode
  statusMessage: string
  traceId: string
  data: T | null
  errors?: AppRouteFieldError[]
}

// ---- Shop / каталог ----

export interface AppRouteFieldDef {
  key: string
  name: string
  type: 'text' | 'email' | 'phone' | 'number'
  required: boolean
}

export interface AppRouteDenomination {
  /** Item/denomination id из каталога — передаётся в POST /orders. */
  id: string
  name: string
  nominal?: string
  price: number // USD
  currency: string // обычно "USD"
  /**
   * Наличие. ВАЖНО: боевой API отдаёт ЧИСЛО (остаток на складе), а моки — boolean.
   * Потребители обязаны обрабатывать оба варианта (см. catalog.ts / sync-approute.mjs).
   */
  inStock: number | boolean
  isLongOrder?: boolean
  minQtyToLongOrder?: number
  /** Код региона аккаунта (например PSN: US/PL/DE/FR/TR/IN/UK), если товар региональный. */
  region?: string
  /**
   * URL обложки номинала, если поставщик его отдаёт. Точное имя поля в боевом API уточняется
   * дампом (scripts/_dump_approute.mjs); извлечение устойчиво к синонимам через pickImageUrl().
   */
  imageUrl?: string
}

export interface AppRouteService {
  id: string
  name: string
  /**
   * Тип сервиса. shop/voucher → мгновенные ваучеры (instant), direct_topup → прямое пополнение (topup).
   * Боевой API отдаёт "voucher" для магазинных товаров и "direct_topup" для DTU (по документации).
   * Значение "dtu" встречается в мок-данных и старых версиях API — поддерживаем оба (см. catalog.ts).
   */
  type: 'shop' | 'dtu' | 'direct_topup' | 'voucher'
  countryCode?: string
  section?: string
  categoryName?: string
  subcategoryName?: string
  description?: string
  /** Номиналы (denominations) сервиса. */
  items: AppRouteDenomination[]
  /** Доп. поля, требуемые продуктом (DTU обычно требует account_reference). */
  fields?: AppRouteFieldDef[]
  minAmountUsd?: number
  maxAmountUsd?: number
  /** URL обложки/иконки сервиса, если поставщик его отдаёт (см. pickImageUrl / дамп API). */
  imageUrl?: string
  /** Steam appId, если сервис привязан к игре Steam — для дериватива обложки header.jpg. */
  appId?: number
  /**
   * Коды регионов для региональных товаров (например PSN: US/PL/DE/FR/TR/IN/UK).
   * Если задано, каждый номинал разворачивается в отдельный SKU на каждый регион
   * (см. catalog.ts → appRouteProducts). В боевом режиме AppRoute обычно отдаёт
   * регионы отдельными сервисами/номиналами — тогда поле не используется.
   */
  regions?: string[]
}

export interface AppRouteServicesPage {
  items: AppRouteService[]
}

// ---- Accounts / funds ----

export interface AppRouteBalanceItem {
  currency: string
  balance: number
  available: number
  reserved: number
  overdraftLimit: number
}

export interface AppRouteFundingMethod {
  code: string
  name: string
  minAmount: number
  commission: number
  ttlMinutes: number
  confirmationsRequired: number
  address?: string
  memoTag?: string
}

export interface AppRouteInvoice {
  id: string
  methodCode: string
  amountExpected: string
  credited: string
  address?: string
  txHash?: string
  status: string
  timeLeftSeconds: number
  confirmations: number
  expiresAt: string
}

export interface AppRouteSteamRates {
  baseCurrencyCode: string
  items: Array<{ quoteCurrencyCode: string; rate: number; providerCreatedAt?: string; fetchedAt?: string }>
}

// ---- Orders ----

export interface AppRouteOrderCreateField {
  key: string
  value: string
}

export interface AppRouteOrderCreateItem {
  denominationId: string
  quantity: number
  isLongOrder?: boolean
  amountCurrencyCode?: string | null
  fields?: AppRouteOrderCreateField[]
}

export interface AppRouteCreateOrderRequest {
  ordersType: 'shop' | 'dtu'
  referenceId?: string // обязателен для покупок, опционален для checkOnly
  checkOnly?: boolean // только для dtu
  orders: AppRouteOrderCreateItem[] // ровно 1 элемент
}

export interface AppRouteVoucher {
  pin?: string
  serialNumber?: string
  expiration?: string
  /** Маскированный код (**** + 4 символа) пока не вызван unhide=true. */
  masked?: boolean
}

export interface AppRouteOrderResult {
  vouchers: AppRouteVoucher[] | null // shop
  attributes?: Record<string, string> // dtu (direct top-up)
}

export interface AppRouteCreateOrderData {
  orderId: string
  status: AppRouteOrderStatus
  result: AppRouteOrderResult
}

export interface AppRouteDtuCheckData {
  canRecharge: boolean
  providerStatus?: string
  providerMessage?: string
  nickname?: string
  quote?: { amount: string; currency: string }
}

export interface AppRouteOrderListItem {
  orderId: string
  reference: string
  status: AppRouteOrderStatus
  itemId?: string
  quantity: number
  amount: number
  vouchers: AppRouteVoucher[] | null
}

export interface AppRouteOrdersPage {
  page: { items: AppRouteOrderListItem[]; hasNext: boolean }
}
