import { describe, it, expect } from 'vitest'
import {
  verifyInitData,
  createSiteLinkToken,
  verifySiteLinkToken,
  createTgClaimCode,
  verifyTgClaimCode,
} from '@/lib/telegram/verify'
import { buildInitData } from '../helpers/telegram'

const BOT = '123456:TEST_TOKEN_for_hmac'
const USER = { id: 555, username: 'alice', first_name: 'Alice' }

describe('verifyInitData — подпись Mini App (ТЗ §5.7, безопасность)', () => {
  it('валидный initData принимается, пользователь распознан', () => {
    const initData = buildInitData(BOT, USER)
    const r = verifyInitData(initData, { botToken: BOT })
    expect(r.ok).toBe(true)
    expect(r.user?.id).toBe(555)
    expect(r.user?.username).toBe('alice')
  })

  it('поддельная подпись (другой токен) отклоняется', () => {
    const initData = buildInitData('999:WRONG_TOKEN', USER)
    const r = verifyInitData(initData, { botToken: BOT })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad_signature')
  })

  it('подмена данных (tampering user) ломает подпись', () => {
    const initData = buildInitData(BOT, USER)
    // Меняем id пользователя после подписи — hash больше не сойдётся.
    const tampered = initData.replace('%22id%22%3A555', '%22id%22%3A777')
    const r = verifyInitData(tampered, { botToken: BOT })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad_signature')
  })

  it('просроченный initData (старый auth_date) отклоняется', () => {
    const old = Math.floor(Date.now() / 1000) - 100000
    const initData = buildInitData(BOT, USER, { authDate: old })
    const r = verifyInitData(initData, { botToken: BOT, maxAgeSec: 3600 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('свежий в пределах maxAge принимается', () => {
    const recent = Math.floor(Date.now() / 1000) - 60
    const initData = buildInitData(BOT, USER, { authDate: recent })
    expect(verifyInitData(initData, { botToken: BOT, maxAgeSec: 3600 }).ok).toBe(true)
  })

  it('пустой initData → no_data', () => {
    expect(verifyInitData('', { botToken: BOT }).reason).toBe('no_data')
  })

  it('без hash → no_hash', () => {
    expect(verifyInitData('user=%7B%7D&auth_date=1', { botToken: BOT }).reason).toBe('no_hash')
  })

  it('валидная подпись, но без поля user → no_user', () => {
    // Соберём initData без user.
    const initData = buildInitDataNoUser(BOT)
    const r = verifyInitData(initData, { botToken: BOT })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_user')
  })
})

describe('Токен привязки сайт→Telegram (deep-link, ТЗ §5.2)', () => {
  const UID = '11111111-2222-3333-4444-555555555555'

  it('подписанный токен валидируется и возвращает userId', () => {
    const token = createSiteLinkToken(UID, { botToken: BOT })
    const r = verifySiteLinkToken(token, { botToken: BOT })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.userId).toBe(UID)
  })

  it('влезает в лимит deep-link (≤64 символа)', () => {
    const token = createSiteLinkToken(UID, { botToken: BOT })
    expect(token.length).toBeLessThanOrEqual(64)
    expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true)
  })

  it('подделка (чужой токен бота) отклоняется', () => {
    const token = createSiteLinkToken(UID, { botToken: 'OTHER:TOKEN' })
    const r = verifySiteLinkToken(token, { botToken: BOT })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_signature')
  })

  it('просроченный токен отклоняется', () => {
    const token = createSiteLinkToken(UID, { botToken: BOT, ttlSec: -10 })
    const r = verifySiteLinkToken(token, { botToken: BOT })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
  })

  it('мусор → malformed', () => {
    const r = verifySiteLinkToken('not-a-real-token', { botToken: BOT })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('malformed')
  })
})

describe('Код привязки Telegram→сайт (claim, ТЗ §5.2)', () => {
  it('подписанный код валидируется и возвращает telegramId', () => {
    const code = createTgClaimCode(987654321, { botToken: BOT })
    const r = verifyTgClaimCode(code, { botToken: BOT })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.telegramId).toBe(987654321)
  })

  it('подделка отклоняется', () => {
    const code = createTgClaimCode(987654321, { botToken: 'OTHER:TOKEN' })
    expect(verifyTgClaimCode(code, { botToken: BOT }).ok).toBe(false)
  })

  it('просрочка отклоняется', () => {
    const code = createTgClaimCode(987654321, { botToken: BOT, ttlSec: -1 })
    const r = verifyTgClaimCode(code, { botToken: BOT })
    if (!r.ok) expect(r.reason).toBe('expired')
  })
})

// initData с валидной подписью, но БЕЗ user — для проверки ветки no_user.
function buildInitDataNoUser(botToken: string): string {
  const { createHmac } = require('crypto')
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAEnoUser',
  }
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(dcs).digest('hex')
  const params = new URLSearchParams(fields)
  params.set('hash', hash)
  return params.toString()
}
