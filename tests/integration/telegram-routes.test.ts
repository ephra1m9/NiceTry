import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── моки бизнес-слоя ──
const h = vi.hoisted(() => ({
  processUpdate: vi.fn(async () => {}),
  verifyInitData: vi.fn(),
  ensureTelegramUser: vi.fn(async () => ({ id: 'u1', email: 'tg1@x', telegram_id: 1, telegram_username: 'a' })),
  issueSessionForEmail: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/telegram/bot', () => ({ processUpdate: h.processUpdate }))
vi.mock('@/lib/telegram/verify', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telegram/verify')>('@/lib/telegram/verify')
  return { ...actual, verifyInitData: h.verifyInitData }
})
vi.mock('@/lib/telegram/account', () => ({ ensureTelegramUser: h.ensureTelegramUser }))
vi.mock('@/lib/telegram/session', () => ({ issueSessionForEmail: h.issueSessionForEmail }))

import { POST as webhookPOST } from '@/app/api/telegram/webhook/route'
import { POST as authPOST } from '@/app/api/telegram/auth/route'
import { WEBHOOK_SECRET } from '@/lib/telegram/config'

function req(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  h.processUpdate.mockClear()
  h.verifyInitData.mockReset()
  h.issueSessionForEmail.mockClear()
  h.issueSessionForEmail.mockResolvedValue({ ok: true })
})

describe('POST /api/telegram/webhook — секрет и обработка (ТЗ §6, безопасность)', () => {
  const URL = 'http://localhost/api/telegram/webhook'

  it('401 при неверном секрете — посторонний не может слать апдейты', async () => {
    const res = await webhookPOST(req(URL, { update_id: 1 }, { 'x-telegram-bot-api-secret-token': 'WRONG' }))
    expect(res.status).toBe(401)
    expect(h.processUpdate).not.toHaveBeenCalled()
  })

  it('401 при отсутствии заголовка секрета', async () => {
    const res = await webhookPOST(req(URL, { update_id: 1 }))
    expect(res.status).toBe(401)
    expect(h.processUpdate).not.toHaveBeenCalled()
  })

  it('401 при секрете-префиксе нужной длины (constant-time, без префиксного байпаса)', async () => {
    const wrongSameLen = 'x'.repeat(WEBHOOK_SECRET.length)
    const res = await webhookPOST(req(URL, { update_id: 1 }, { 'x-telegram-bot-api-secret-token': wrongSameLen }))
    expect(res.status).toBe(401)
    expect(h.processUpdate).not.toHaveBeenCalled()
  })

  it('200 при верном секрете, апдейт уходит в обработку', async () => {
    const res = await webhookPOST(
      req(URL, { update_id: 2, message: { text: '/start' } }, { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET })
    )
    expect(res.status).toBe(200)
    expect(h.processUpdate).toHaveBeenCalledTimes(1)
  })

  it('400 при некорректном JSON', async () => {
    const bad = new NextRequest(URL, {
      method: 'POST',
      body: 'not-json{',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    })
    const res = await webhookPOST(bad)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/telegram/auth — Mini App авторизация (ТЗ §5.7)', () => {
  const URL = 'http://localhost/api/telegram/auth'

  it('400 если initData отсутствует', async () => {
    const res = await authPOST(req(URL, {}))
    expect(res.status).toBe(400)
  })

  it('403 при поддельной подписи', async () => {
    h.verifyInitData.mockReturnValue({ ok: false, reason: 'bad_signature' })
    const res = await authPOST(req(URL, { initData: 'fake' }))
    expect(res.status).toBe(403)
    expect(h.issueSessionForEmail).not.toHaveBeenCalled()
  })

  it('401 при просроченном initData', async () => {
    h.verifyInitData.mockReturnValue({ ok: false, reason: 'expired' })
    const res = await authPOST(req(URL, { initData: 'old' }))
    expect(res.status).toBe(401)
  })

  it('200 при валидной подписи: создаётся аккаунт и выдаётся сессия', async () => {
    h.verifyInitData.mockReturnValue({ ok: true, user: { id: 1, username: 'a' } })
    const res = await authPOST(req(URL, { initData: 'valid' }))
    expect(res.status).toBe(200)
    expect(h.ensureTelegramUser).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(h.issueSessionForEmail).toHaveBeenCalledWith('tg1@x')
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('500 если сессию выдать не удалось', async () => {
    h.verifyInitData.mockReturnValue({ ok: true, user: { id: 1 } })
    h.issueSessionForEmail.mockResolvedValue({ ok: false, error: 'no session' } as any)
    const res = await authPOST(req(URL, { initData: 'valid' }))
    expect(res.status).toBe(500)
  })

  it('не утекает сырая ошибка Supabase в тело ответа (Блок 4 аудита)', async () => {
    h.verifyInitData.mockReturnValue({ ok: true, user: { id: 1 } })
    h.issueSessionForEmail.mockResolvedValue({ ok: false, error: 'pg://secret connection string' } as any)
    const res = await authPOST(req(URL, { initData: 'valid' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('secret connection')
  })

  it('сессия выдаётся для email из ПРОВЕРЕННОГО initData, а не из тела запроса (анти-impersonation)', async () => {
    h.verifyInitData.mockReturnValue({ ok: true, user: { id: 1 } })
    // Атакующий подсовывает чужой email/telegram_id в тело — должен игнорироваться.
    const res = await authPOST(req(URL, { initData: 'valid', email: 'victim@x', telegram_id: 999 }))
    expect(res.status).toBe(200)
    // ensureTelegramUser вызван с user из verifyInitData (id:1), email берётся из его профиля (tg1@x).
    expect(h.ensureTelegramUser).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(h.issueSessionForEmail).toHaveBeenCalledWith('tg1@x')
  })
})
