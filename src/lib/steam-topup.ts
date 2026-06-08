// Чистая бизнес-логика пополнения Steam-кошелька через pay4game (без I/O — тестируемо).
//
// ДЕНЕЖНАЯ МОДЕЛЬ (см. WORKLOG_PAY4GAME.md, Этап 12):
//   Пользователь вводит СУММУ ПОПОЛНЕНИЯ в ₽ — столько зачислится в Steam-кошелёк (это steam_amount,
//   по доке pay4game 100–50000 ₽). Комиссия сервиса берётся СВЕРХУ: к оплате
//   charge = round(steamAmount * (1 + commission%)). Именно charge идёт в pay4game как amount платежа.
//   pay4game зачисляет кошелёк в валюте аккаунта по своему курсу; РЕГИОН у нас — метаданные
//   (store-регион аккаунта) для оператора/описания: в payment/create отдельного поля региона нет.
//
// Лимиты и комиссия настраиваются через env с безопасными дефолтами (см. getSteamTopupConfig).

/** Поддерживаемые store-регионы Steam-аккаунта (для подсказки/описания, не валюта оплаты). */
export interface SteamRegion {
  code: string
  /** Человекочитаемое название. */
  label: string
  /** Эмодзи-флаг для UI. */
  flag: string
  /** Валюта кошелька в этом регионе (информативно). */
  walletCurrency: string
}

/** Список регионов. RU — по умолчанию (первый). */
export const STEAM_REGIONS: SteamRegion[] = [
  { code: 'RU', label: 'Россия', flag: '🇷🇺', walletCurrency: '₽' },
  { code: 'KZ', label: 'Казахстан', flag: '🇰🇿', walletCurrency: '₸' },
  { code: 'UA', label: 'Украина', flag: '🇺🇦', walletCurrency: '₴' },
  { code: 'BY', label: 'Беларусь', flag: '🇧🇾', walletCurrency: 'Br' },
  { code: 'OTHER', label: 'Другой регион', flag: '🌍', walletCurrency: '—' },
]

export const DEFAULT_REGION = STEAM_REGIONS[0].code

/** Найти регион по коду (без учёта регистра). */
export function findRegion(code: string | null | undefined): SteamRegion | undefined {
  if (!code) return undefined
  const c = code.trim().toUpperCase()
  return STEAM_REGIONS.find((r) => r.code === c)
}

export interface SteamTopupConfig {
  /** Минимальная сумма пополнения, ₽. */
  min: number
  /** Максимальная сумма пополнения, ₽. */
  max: number
  /** Процент комиссии сервиса (сверху на сумму пополнения). */
  commissionPercent: number
}

/** Прочитать конфиг лимитов/комиссии из env (дефолты согласованы с доком pay4game). */
export function getSteamTopupConfig(env: Record<string, string | undefined> = process.env): SteamTopupConfig {
  const num = (v: string | undefined, def: number): number => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : def
  }
  // pay4game допускает steam_amount 20–50000 ₽; практический нижний порог Steam берём 100 ₽.
  const min = num(env.STEAM_TOPUP_MIN, 100)
  const max = num(env.STEAM_TOPUP_MAX, 50000)
  const commissionPercent = num(env.STEAM_TOPUP_COMMISSION_PERCENT, 3)
  return { min, max: Math.max(min, max), commissionPercent }
}

/** Комиссия сервиса (₽), округлённая до рубля. */
export function commissionRub(steamAmount: number, commissionPercent: number): number {
  if (!Number.isFinite(steamAmount) || steamAmount <= 0) return 0
  return Math.round((steamAmount * commissionPercent) / 100)
}

/** Итого к оплате (₽) = сумма пополнения + комиссия. */
export function chargeRub(steamAmount: number, commissionPercent: number): number {
  return Math.round(steamAmount) + commissionRub(steamAmount, commissionPercent)
}

/**
 * Нормализовать Steam-логин: обрезать пробелы и ведущий «@». Профильные ссылки/ID не
 * преобразуем — pay4game ждёт именно логин аккаунта (account login).
 */
export function normalizeSteamAccount(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^@+/, '')
}

const STEAM_ACCOUNT_RE = /^[A-Za-z0-9_.-]{2,64}$/

/** Валиден ли Steam-логин (латиница/цифры/._- , 2–64 символа). */
export function isValidSteamAccount(account: string): boolean {
  return STEAM_ACCOUNT_RE.test(account)
}

export interface ValidatedTopup {
  account: string
  region: SteamRegion
  steamAmount: number
  commission: number
  charge: number
}

/**
 * Полная валидация запроса на пополнение. Возвращает либо нормализованные данные (+расчёт сумм),
 * либо понятную ошибку. Email здесь НЕ проверяем — это делает вызывающий (общий хелпер auth/codes).
 */
export function validateTopup(
  input: { account?: unknown; region?: unknown; amount?: unknown },
  cfg: SteamTopupConfig = getSteamTopupConfig()
): { ok: true; value: ValidatedTopup } | { ok: false; error: string } {
  const account = normalizeSteamAccount(input.account)
  if (!account) return { ok: false, error: 'Укажите логин Steam' }
  if (!isValidSteamAccount(account)) {
    return { ok: false, error: 'Некорректный логин Steam (латиница, цифры, . _ -, 2–64 символа)' }
  }

  const region = findRegion(input.region as string) ?? findRegion(DEFAULT_REGION)!

  const steamAmount = Math.round(Number(input.amount))
  if (!Number.isFinite(steamAmount) || steamAmount <= 0) {
    return { ok: false, error: 'Укажите сумму пополнения' }
  }
  if (steamAmount < cfg.min || steamAmount > cfg.max) {
    return { ok: false, error: `Сумма пополнения должна быть от ${cfg.min} до ${cfg.max} ₽` }
  }

  const commission = commissionRub(steamAmount, cfg.commissionPercent)
  const charge = chargeRub(steamAmount, cfg.commissionPercent)
  return { ok: true, value: { account, region, steamAmount, commission, charge } }
}
