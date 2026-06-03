import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeSupabase } from '../helpers/telegram'

// Стейтовый фейк supabaseAdmin — общий для модуля account.ts.
const state: { db: FakeSupabase } = { db: new FakeSupabase() }

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (t: string) => state.db.from(t),
    auth: { admin: { ...{} } },
  },
}))

// Подменяем методы auth.admin на методы фейка в каждом тесте (через геттер ниже).
import { ensureTelegramUser, linkTelegramToUser, findUserByTelegramId } from '@/lib/telegram/account'
import { supabaseAdmin } from '@/lib/supabase/admin'

function freshDb(seed = {}) {
  state.db = new FakeSupabase(seed)
  // Привязываем auth.admin фейка к мокнутому supabaseAdmin.
  ;(supabaseAdmin as any).auth = state.db.auth
}

beforeEach(() => freshDb())

describe('ensureTelegramUser — telegram-first (ТЗ §5.7)', () => {
  it('создаёт auth-пользователя и профиль при первом /start', async () => {
    const p = await ensureTelegramUser({ id: 100, username: 'neo', first_name: 'Neo' })
    expect(p.telegram_id).toBe(100)
    expect(p.email).toBe('tg100@telegram.nicetry.local')
    expect(p.referral_code).toMatch(/^[A-Z0-9]{8}$/)
    expect(state.db.tables.users).toHaveLength(1)
    expect(state.db.authUsers).toHaveLength(1)
  })

  it('идемпотентен: повторный /start не плодит дубли', async () => {
    await ensureTelegramUser({ id: 100, username: 'neo' })
    const again = await ensureTelegramUser({ id: 100, username: 'neo' })
    expect(again.telegram_id).toBe(100)
    expect(state.db.tables.users).toHaveLength(1)
    expect(state.db.authUsers).toHaveLength(1)
  })

  it('подтягивает изменившийся username', async () => {
    await ensureTelegramUser({ id: 100, username: 'old' })
    const upd = await ensureTelegramUser({ id: 100, username: 'new' })
    expect(upd.telegram_username).toBe('new')
  })
})

describe('linkTelegramToUser — email-first привязка (ТЗ §5.2)', () => {
  it('привязывает telegram_id к существующему email-аккаунту', async () => {
    freshDb({
      users: [{ id: 'site-1', email: 'a@b.com', telegram_id: null, balance: 0, referral_code: 'AAAA1111' }],
    })
    const res = await linkTelegramToUser('site-1', { id: 200, username: 'bob' })
    expect(res.ok).toBe(true)
    const u = await findUserByTelegramId(200)
    expect(u?.id).toBe('site-1')
    expect(u?.telegram_username).toBe('bob')
  })

  it('идемпотентна: повторная привязка к тому же аккаунту — ok', async () => {
    freshDb({
      users: [{ id: 'site-1', email: 'a@b.com', telegram_id: 200, balance: 0, referral_code: 'AAAA1111' }],
    })
    const res = await linkTelegramToUser('site-1', { id: 200 })
    expect(res.ok).toBe(true)
  })

  it('КОНФЛИКТ: telegram_id занят НЕпустым аккаунтом → reason:conflict', async () => {
    freshDb({
      users: [
        { id: 'site-1', email: 'a@b.com', telegram_id: null, balance: 0, referral_code: 'AAAA1111' },
        { id: 'tg-acc', email: 'tg200@telegram.nicetry.local', telegram_id: 200, balance: 500, referral_code: 'BBBB2222' },
      ],
      orders: [{ id: 'o1', user_id: 'tg-acc' }],
    })
    const res = await linkTelegramToUser('site-1', { id: 200 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('conflict')
    // Привязка не должна была переехать.
    expect((await findUserByTelegramId(200))?.id).toBe('tg-acc')
  })

  it('СЛИЯНИЕ: telegram_id занят ПУСТЫМ авто-аккаунтом → переносится, авто-аккаунт удаляётся', async () => {
    freshDb({
      users: [
        { id: 'site-1', email: 'a@b.com', telegram_id: null, balance: 0, referral_code: 'AAAA1111' },
        { id: 'tg-empty', email: 'tg200@telegram.nicetry.local', telegram_id: 200, balance: 0, referral_code: 'BBBB2222' },
      ],
      orders: [],
    })
    ;(supabaseAdmin as any).auth = state.db.auth
    state.db.authUsers.push({ id: 'tg-empty', email: 'tg200@telegram.nicetry.local' })

    const res = await linkTelegramToUser('site-1', { id: 200 })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.merged).toBe(true)
    // telegram_id теперь у site-1, пустой авто-аккаунт удалён.
    expect((await findUserByTelegramId(200))?.id).toBe('site-1')
    expect(state.db.tables.users.find((u) => u.id === 'tg-empty')).toBeUndefined()
  })

  it('аккаунт для привязки не найден → reason:not_found', async () => {
    freshDb({ users: [] })
    const res = await linkTelegramToUser('missing', { id: 200 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not_found')
  })
})
