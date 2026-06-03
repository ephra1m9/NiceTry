// Криптография Telegram: проверка подписи initData (Mini App) и подписанные токены привязки.
//
// БЕЗОПАСНОСТЬ: никогда не доверяем данным с клиента. Подлинность Telegram-пользователя
// в Mini App подтверждается ТОЛЬКО проверкой HMAC-подписи initData на сервере (ниже).
// Токены привязки аккаунтов тоже подписаны (HMAC), их нельзя подделать или переиспользовать
// после истечения срока.

import { createHmac, timingSafeEqual } from 'crypto'
import { BOT_TOKEN, LINK_TOKEN_TTL_SEC, INITDATA_MAX_AGE_SEC } from './config'

// ───────────────────────────── initData (Telegram WebApp) ─────────────────────────────

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
}

export interface InitDataResult {
  ok: boolean
  reason?: 'no_data' | 'no_hash' | 'bad_signature' | 'expired' | 'no_user'
  user?: TelegramUser
  authDate?: number
}

/**
 * Проверка подписи initData по алгоритму Telegram WebApp.
 *
 *   secret_key   = HMAC_SHA256(key="WebAppData", message=bot_token)
 *   data_check   = строки "key=value" (КРОМЕ hash), отсортированные по ключу, через "\n"
 *   valid        = HMAC_SHA256(key=secret_key, message=data_check) == hash (hex)
 *
 * Дополнительно проверяется свежесть auth_date (защита от воспроизведения старого initData).
 */
export function verifyInitData(
  initData: string,
  opts: { botToken?: string; maxAgeSec?: number; now?: number } = {}
): InitDataResult {
  const botToken = opts.botToken ?? BOT_TOKEN
  if (!initData) return { ok: false, reason: 'no_data' }
  if (!botToken) return { ok: false, reason: 'bad_signature' }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return { ok: false, reason: 'no_hash' }

  // data_check_string: все пары, кроме hash, отсортированные по ключу.
  const pairs: string[] = []
  params.forEach((value, key) => {
    if (key === 'hash') return
    pairs.push(`${key}=${value}`)
  })
  pairs.sort()
  const dataCheckString = pairs.join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (!safeEqualHex(computed, hash)) return { ok: false, reason: 'bad_signature' }

  // Свежесть.
  const authDate = Number(params.get('auth_date') || 0)
  const maxAge = opts.maxAgeSec ?? INITDATA_MAX_AGE_SEC
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  if (!authDate || now - authDate > maxAge) {
    return { ok: false, reason: 'expired', authDate }
  }

  // Пользователь.
  const userRaw = params.get('user')
  let user: TelegramUser | undefined
  if (userRaw) {
    try {
      user = JSON.parse(userRaw)
    } catch {
      /* битый user — оставляем undefined */
    }
  }
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'no_user', authDate }

  return { ok: true, user, authDate }
}

// ───────────────────────────── Токены привязки аккаунта ─────────────────────────────
//
// Stateless: вся информация внутри токена, БД для кодов не нужна.
// Формат (binary, base64url): [1 байт версия][payload][16 байт усечённый HMAC].
//   - site:  payload = 16 байт UUID + 5 байт exp(сек)         → ~48 символов (влезает в deep-link ≤64)
//   - tg:    payload = 8 байт telegram_id (BE) + 5 байт exp    → ~40 символов
// HMAC берётся от (версия+payload) с ключом = токен бота.

const VER_SITE = 0x01
const VER_TG = 0x02
const HMAC_LEN = 16

function linkSecret(botToken = BOT_TOKEN): Buffer {
  // Отдельный домен от initData, чтобы ключи не пересекались.
  return createHmac('sha256', 'NiceTryLinkToken').update(botToken).digest()
}

function macOf(versionAndPayload: Buffer, botToken = BOT_TOKEN): Buffer {
  return createHmac('sha256', linkSecret(botToken)).update(versionAndPayload).digest().subarray(0, HMAC_LEN)
}

function packExp(exp: number): Buffer {
  // 5 байт хватает до 2^40 секунд (~36812 год).
  const b = Buffer.alloc(5)
  b.writeUIntBE(exp, 0, 5)
  return b
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) throw new Error('bad uuid')
  return Buffer.from(hex, 'hex')
}
function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** Токен «привязать сайт-аккаунт к Telegram»: кладётся в deep-link t.me/<bot>?start=<token>. */
export function createSiteLinkToken(
  userId: string,
  opts: { ttlSec?: number; now?: number; botToken?: string } = {}
): string {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const exp = now + (opts.ttlSec ?? LINK_TOKEN_TTL_SEC)
  const payload = Buffer.concat([uuidToBytes(userId), packExp(exp)])
  const vp = Buffer.concat([Buffer.from([VER_SITE]), payload])
  return b64url(Buffer.concat([vp, macOf(vp, opts.botToken)]))
}

export function verifySiteLinkToken(
  token: string,
  opts: { now?: number; botToken?: string } = {}
): { ok: true; userId: string } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' } {
  try {
    const raw = fromB64url(token.trim())
    if (raw.length !== 1 + 16 + 5 + HMAC_LEN || raw[0] !== VER_SITE) return { ok: false, reason: 'malformed' }
    const vp = raw.subarray(0, 1 + 16 + 5)
    const mac = raw.subarray(1 + 16 + 5)
    if (!safeEqualBuf(mac, macOf(vp, opts.botToken))) return { ok: false, reason: 'bad_signature' }
    const exp = vp.subarray(1 + 16).readUIntBE(0, 5)
    const now = opts.now ?? Math.floor(Date.now() / 1000)
    if (now > exp) return { ok: false, reason: 'expired' }
    return { ok: true, userId: bytesToUuid(vp.subarray(1, 1 + 16)) }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

/** Код «привязать Telegram-аккаунт к сайту»: бот выдаёт, пользователь вводит на сайте. */
export function createTgClaimCode(
  telegramId: number,
  opts: { ttlSec?: number; now?: number; botToken?: string } = {}
): string {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const exp = now + (opts.ttlSec ?? LINK_TOKEN_TTL_SEC)
  const idBuf = Buffer.alloc(8)
  idBuf.writeBigUInt64BE(BigInt(telegramId))
  const payload = Buffer.concat([idBuf, packExp(exp)])
  const vp = Buffer.concat([Buffer.from([VER_TG]), payload])
  return b64url(Buffer.concat([vp, macOf(vp, opts.botToken)]))
}

export function verifyTgClaimCode(
  code: string,
  opts: { now?: number; botToken?: string } = {}
): { ok: true; telegramId: number } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' } {
  try {
    const raw = fromB64url(code.trim())
    if (raw.length !== 1 + 8 + 5 + HMAC_LEN || raw[0] !== VER_TG) return { ok: false, reason: 'malformed' }
    const vp = raw.subarray(0, 1 + 8 + 5)
    const mac = raw.subarray(1 + 8 + 5)
    if (!safeEqualBuf(mac, macOf(vp, opts.botToken))) return { ok: false, reason: 'bad_signature' }
    const exp = vp.subarray(1 + 8).readUIntBE(0, 5)
    const now = opts.now ?? Math.floor(Date.now() / 1000)
    if (now > exp) return { ok: false, reason: 'expired' }
    return { ok: true, telegramId: Number(vp.subarray(1, 1 + 8).readBigUInt64BE()) }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

// ───────────────────────────── утилиты сравнения ─────────────────────────────

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
function safeEqualBuf(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
