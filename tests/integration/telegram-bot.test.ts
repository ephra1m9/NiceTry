import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TelegramApiError } from '@/lib/telegram/client'
import { createSiteLinkToken } from '@/lib/telegram/verify'

// Мутабельное состояние моков — через vi.hoisted, т.к. vi.mock хойстится выше объявлений.
const h = vi.hoisted(() => ({
  sent: [] as Array<{ chatId: number | string; text: string; markup?: any }>,
  answered: [] as string[],
  adminState: { telegramId: 12345 as number | null },
  accountMock: {
    ensureTelegramUser: vi.fn(async (tg: any) => ({ id: 'u1', telegram_id: tg.id, email: `tg${tg.id}@x` })),
    findUserByTelegramId: vi.fn(async () => null),
    linkTelegramToUser: vi.fn(async () => ({ ok: true, merged: false, profile: {} })),
  },
}))
const { sent, answered, adminState, accountMock } = h

vi.mock('@/lib/telegram/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telegram/client')>('@/lib/telegram/client')
  return {
    ...actual,
    sendMessage: vi.fn(async (chatId: number | string, text: string, opts: any = {}) => {
      h.sent.push({ chatId, text, markup: opts.reply_markup })
      return { message_id: 1 }
    }),
    answerCallbackQuery: vi.fn(async (id: string) => {
      h.answered.push(id)
      return true
    }),
  }
})

vi.mock('@/lib/telegram/account', () => h.accountMock)

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { telegram_id: h.adminState.telegramId }, error: null }),
        }),
      }),
    }),
  },
}))

import { processUpdate } from '@/lib/telegram/bot'
import { notifyUser, notifyOrderDelivered } from '@/lib/telegram/notify'
import * as client from '@/lib/telegram/client'

const BOT = process.env.TELEGRAM_BOT_TOKEN || ''

beforeEach(() => {
  sent.length = 0
  answered.length = 0
  accountMock.ensureTelegramUser.mockClear()
  accountMock.linkTelegramToUser.mockClear()
  accountMock.linkTelegramToUser.mockResolvedValue({ ok: true, merged: false, profile: {} } as any)
  adminState.telegramId = 12345
})

describe('processUpdate — команды и меню (ТЗ §5.7)', () => {
  it('/start без параметра: создаёт аккаунт и шлёт приветствие с кнопкой Mini App', async () => {
    await processUpdate({ message: { message_id: 1, chat: { id: 999 }, from: { id: 999, first_name: 'Сэм' }, text: '/start' } })
    expect(accountMock.ensureTelegramUser).toHaveBeenCalledWith(expect.objectContaining({ id: 999 }))
    expect(sent).toHaveLength(1)
    expect(sent[0].chatId).toBe(999)
    // В меню есть web_app кнопка «Открыть магазин».
    const flat = JSON.stringify(sent[0].markup)
    expect(flat).toContain('web_app')
    expect(flat).toContain('Открыть магазин')
  })

  it('/help: показывает справку', async () => {
    await processUpdate({ message: { message_id: 2, chat: { id: 999 }, from: { id: 999 }, text: '/help' } })
    expect(sent[0].text).toContain('Команды')
  })

  it('/start <валидный токен>: привязывает аккаунт сайта и подтверждает', async () => {
    const token = createSiteLinkToken('11111111-2222-3333-4444-555555555555', { botToken: BOT })
    await processUpdate({ message: { message_id: 3, chat: { id: 999 }, from: { id: 999 }, text: `/start ${token}` } })
    expect(accountMock.linkTelegramToUser).toHaveBeenCalledWith(
      '11111111-2222-3333-4444-555555555555',
      expect.objectContaining({ id: 999 })
    )
    expect(sent.some((s) => s.text.includes('привязан'))).toBe(true)
  })

  it('/start <битый токен>: предупреждение, привязка не вызывается', async () => {
    await processUpdate({ message: { message_id: 4, chat: { id: 999 }, from: { id: 999 }, text: '/start brokentoken' } })
    expect(accountMock.linkTelegramToUser).not.toHaveBeenCalled()
    expect(sent.some((s) => s.text.includes('недействительна'))).toBe(true)
  })

  it('/start <валидный токен> при конфликте: предупреждение о другом аккаунте', async () => {
    accountMock.linkTelegramToUser.mockResolvedValue({ ok: false, reason: 'conflict', conflictUserId: 'x' } as any)
    const token = createSiteLinkToken('11111111-2222-3333-4444-555555555555', { botToken: BOT })
    await processUpdate({ message: { message_id: 5, chat: { id: 999 }, from: { id: 999 }, text: `/start ${token}` } })
    expect(sent.some((s) => s.text.includes('уже привязан к другому'))).toBe(true)
  })

  it('callback link_code: отвечает на callback и выдаёт код привязки', async () => {
    await processUpdate({
      callback_query: { id: 'cb1', from: { id: 999 }, message: { message_id: 6, chat: { id: 999 } }, data: 'link_code' },
    })
    expect(answered).toContain('cb1')
    expect(sent.some((s) => s.text.includes('Код привязки'))).toBe(true)
  })

  it('не бросает при ошибке обработчика (устойчивость webhook)', async () => {
    accountMock.ensureTelegramUser.mockRejectedValueOnce(new Error('db down'))
    await expect(
      processUpdate({ message: { message_id: 7, chat: { id: 999 }, from: { id: 999 }, text: '/start' } })
    ).resolves.toBeUndefined()
  })
})

describe('notify — доставка уведомлений (ТЗ §5.8)', () => {
  it('доставляет привязанному пользователю', async () => {
    const r = await notifyUser('u1', 'Привет')
    expect(r.sent).toBe(true)
    expect(sent[0].text).toBe('Привет')
  })

  it('нет привязки telegram_id → not_linked, ничего не шлём', async () => {
    adminState.telegramId = null
    const r = await notifyUser('u1', 'Привет')
    expect(r.sent).toBe(false)
    expect(r.reason).toBe('not_linked')
    expect(sent).toHaveLength(0)
  })

  it('бот заблокирован (403) → reason:blocked, поток не падает', async () => {
    ;(client.sendMessage as any).mockImplementationOnce(async () => {
      throw new TelegramApiError('blocked', 403, 'bot was blocked by the user')
    })
    const r = await notifyUser('u1', 'Привет')
    expect(r.sent).toBe(false)
    expect(r.reason).toBe('blocked')
  })

  it('notifyOrderDelivered формирует сообщение с кодом и кнопкой', async () => {
    await notifyOrderDelivered('u1', { order_number: 'NT-1' }, [{ product_name: 'Steam $10', voucher_code: 'ABC-123' }])
    expect(sent[0].text).toContain('NT-1')
    expect(sent[0].text).toContain('ABC-123')
    expect(JSON.stringify(sent[0].markup)).toContain('web_app')
  })
})
