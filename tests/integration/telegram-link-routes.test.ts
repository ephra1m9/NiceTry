import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── моки слоёв (бизнес-логика проверяется в telegram-account.test.ts; здесь — гарды роутов) ──
const h = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  verifyTgClaimCode: vi.fn(),
  linkTelegramToUser: vi.fn(),
  createSiteLinkToken: vi.fn(() => 'SIGNED_TOKEN'),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
  }),
}))
vi.mock('@/lib/telegram/verify', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telegram/verify')>('@/lib/telegram/verify')
  return { ...actual, verifyTgClaimCode: h.verifyTgClaimCode, createSiteLinkToken: h.createSiteLinkToken }
})
vi.mock('@/lib/telegram/account', () => ({ linkTelegramToUser: h.linkTelegramToUser }))

import { POST as claimPOST } from '@/app/api/telegram/claim/route'
import { POST as linkTokenPOST } from '@/app/api/telegram/link-token/route'

function req(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  h.user = null
  h.verifyTgClaimCode.mockReset()
  h.linkTelegramToUser.mockReset()
})

describe('POST /api/telegram/claim — привязка по коду (Блок 3 аудита)', () => {
  const URL = 'http://localhost/api/telegram/claim'

  it('401 без авторизации — нельзя привязать к чужому аккаунту', async () => {
    h.user = null
    const res = await claimPOST(req(URL, { code: 'x' }))
    expect(res.status).toBe(401)
    expect(h.linkTelegramToUser).not.toHaveBeenCalled()
  })

  it('400 если код не указан', async () => {
    h.user = { id: 'u1' }
    const res = await claimPOST(req(URL, {}))
    expect(res.status).toBe(400)
  })

  it('400 при недействительном (поддельном) коде', async () => {
    h.user = { id: 'u1' }
    h.verifyTgClaimCode.mockReturnValue({ ok: false, reason: 'bad_signature' })
    const res = await claimPOST(req(URL, { code: 'forged' }))
    expect(res.status).toBe(400)
    expect(h.linkTelegramToUser).not.toHaveBeenCalled()
  })

  it('400 при просроченном коде', async () => {
    h.user = { id: 'u1' }
    h.verifyTgClaimCode.mockReturnValue({ ok: false, reason: 'expired' })
    const res = await claimPOST(req(URL, { code: 'old' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.reason).toBe('expired')
  })

  it('409 при конфликте — нельзя перехватить чужой telegram_id', async () => {
    h.user = { id: 'u1' }
    h.verifyTgClaimCode.mockReturnValue({ ok: true, telegramId: 555 })
    h.linkTelegramToUser.mockResolvedValue({ ok: false, reason: 'conflict', conflictUserId: 'other' })
    const res = await claimPOST(req(URL, { code: 'valid' }))
    expect(res.status).toBe(409)
  })

  it('привязка идёт к id ИЗ СЕССИИ, а не из запроса (анти-IDOR)', async () => {
    h.user = { id: 'session-user' }
    h.verifyTgClaimCode.mockReturnValue({ ok: true, telegramId: 555 })
    h.linkTelegramToUser.mockResolvedValue({ ok: true, merged: false, profile: {} })
    const res = await claimPOST(req(URL, { code: 'valid', user_id: 'ATTACKER' }))
    expect(res.status).toBe(200)
    expect(h.linkTelegramToUser).toHaveBeenCalledWith('session-user', { id: 555 })
  })

  it('500 при внутренней ошибке без утечки деталей', async () => {
    h.user = { id: 'u1' }
    h.verifyTgClaimCode.mockReturnValue({ ok: true, telegramId: 555 })
    h.linkTelegramToUser.mockRejectedValue(new Error('db secret leak details'))
    const res = await claimPOST(req(URL, { code: 'valid' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('secret leak')
  })
})

describe('POST /api/telegram/link-token — выдача deep-link (Блок 3 аудита)', () => {
  const URL = 'http://localhost/api/telegram/link-token'

  it('401 без авторизации — токен привязки выдаётся только владельцу сессии', async () => {
    h.user = null
    const res = await linkTokenPOST()
    expect(res.status).toBe(401)
    expect(h.createSiteLinkToken).not.toHaveBeenCalled()
  })

  it('200 для авторизованного: токен подписывает id ИЗ СЕССИИ', async () => {
    h.user = { id: 'session-user' }
    const res = await linkTokenPOST()
    expect(res.status).toBe(200)
    expect(h.createSiteLinkToken).toHaveBeenCalledWith('session-user')
    const body = await res.json()
    expect(body.url).toContain('SIGNED_TOKEN')
  })
})
