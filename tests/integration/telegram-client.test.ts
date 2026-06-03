import { describe, it, expect, vi, afterEach } from 'vitest'
import { callTelegram, TelegramApiError } from '@/lib/telegram/client'

const TOKEN = '123:TESTTOKEN'

afterEach(() => vi.restoreAllMocks())

function mockFetchSequence(responses: Array<{ ok: boolean; result?: any; error_code?: number; description?: string; parameters?: any } | 'reject'>) {
  let i = 0
  return vi.spyOn(global, 'fetch' as any).mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    if (r === 'reject') throw new TypeError('fetch failed')
    return { status: r.ok ? 200 : r.error_code || 400, json: async () => r } as any
  })
}

describe('callTelegram — ретраи и обработка ошибок (ТЗ §6, надёжность)', () => {
  it('успех: возвращает result', async () => {
    mockFetchSequence([{ ok: true, result: { message_id: 1 } }])
    const res = await callTelegram('sendMessage', { chat_id: 1, text: 'hi' }, { token: TOKEN })
    expect(res).toEqual({ message_id: 1 })
  })

  it('403 (бот заблокирован) — терминально, без ретрая, isBlocked=true', async () => {
    const spy = mockFetchSequence([
      { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
    ])
    await expect(callTelegram('sendMessage', {}, { token: TOKEN })).rejects.toMatchObject({ errorCode: 403 })
    expect(spy).toHaveBeenCalledTimes(1)
    try {
      await callTelegram('sendMessage', {}, { token: TOKEN })
    } catch (e) {
      expect(e).toBeInstanceOf(TelegramApiError)
      expect((e as TelegramApiError).isBlocked).toBe(true)
    }
  })

  it('429 (flood) — повтор после retry_after, затем успех', async () => {
    const spy = mockFetchSequence([
      { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } },
      { ok: true, result: { ok: 1 } },
    ])
    const res = await callTelegram('sendMessage', {}, { token: TOKEN })
    expect(res).toEqual({ ok: 1 })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('сетевой сбой — ретраи, затем network_error', async () => {
    const spy = mockFetchSequence(['reject', 'reject'])
    await expect(callTelegram('sendMessage', {}, { token: TOKEN, attempts: 2 })).rejects.toMatchObject({
      description: 'network_error',
    })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('без токена — внятная ошибка', async () => {
    await expect(callTelegram('getMe', {}, { token: '' })).rejects.toMatchObject({ description: 'no_token' })
  })
})
