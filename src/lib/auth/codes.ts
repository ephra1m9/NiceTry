// Генерация, хеширование и проверка одноразовых кодов входа.
//
// Код в БД НЕ хранится в открытом виде — только HMAC-SHA256(secret, email + ':' + code).
// Привязываем хеш к почте, чтобы один и тот же код для разных адресов давал разные хеши.
// Секрет — AUTH_SESSION_SECRET (см. .env.example). Если секрет не задан, в dev используем
// фолбэк-строку (коды всё равно хешируются), в prod это конфигурационная ошибка.

import { createHmac, timingSafeEqual } from 'crypto'

/** Длина кода (цифр). */
export const CODE_LENGTH = 6

/** TTL кода в минутах (из env, по умолчанию 10). */
export function codeTtlMinutes(): number {
  const raw = Number(process.env.AUTH_CODE_TTL_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10
}

/** Максимум неудачных попыток ввода до блокировки кода. */
export const MAX_CODE_ATTEMPTS = 5

function secret(): string {
  const s = process.env.AUTH_SESSION_SECRET
  if (s && s.length > 0) return s
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SESSION_SECRET не задан в production — невозможно безопасно хешировать коды')
  }
  // Dev-фолбэк: коды всё равно хешируются, но секрет нестойкий. Для локальной отладки.
  return 'dev-insecure-auth-secret'
}

/** Сгенерировать случайный 6-значный код (с ведущими нулями). Криптослучайность. */
export function generateCode(): string {
  // randomInt не зависит от смещения по модулю; диапазон [0, 10^len).
  // Используем crypto.randomInt для равномерности.
  const { randomInt } = require('crypto') as typeof import('crypto')
  const max = 10 ** CODE_LENGTH
  const n = randomInt(0, max)
  return n.toString().padStart(CODE_LENGTH, '0')
}

/** Хеш кода, привязанный к почте. */
export function hashCode(email: string, code: string): string {
  return createHmac('sha256', secret())
    .update(`${email.toLowerCase()}:${code}`)
    .digest('hex')
}

/** Сравнить введённый код с сохранённым хешем за постоянное время. */
export function verifyCodeHash(email: string, code: string, storedHash: string): boolean {
  const computed = hashCode(email, code)
  const a = Buffer.from(computed, 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Нормализовать почту: trim + нижний регистр. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Базовая валидация формата почты (тот же мягкий уровень, что и в существующих роутах). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
