import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { retry } from '../helpers/live'

// ============================================================
// Задача 7: polling статуса выдачи Dessly.
// Симулируем «свежий» заказ Dessly: sendGift → pending, затем getTransactionStatus
// отдаёт pending, и лишь на втором опросе — completed (как в реальности: paid→executing→completed
// за несколько секунд). Проверяем, что заказ НЕ помечается failed раньше времени, а доводится
// до delivered после пауз между опросами.
//
// @/lib/dessly мокается на уровне модуля (sendGift/getTransactionStatus/resolvePackage),
// поэтому глобальный fetch НЕ трогаем — supabaseAdmin продолжает работать с живой БД.
// ============================================================

// Счётчик опросов статуса — через vi.hoisted, чтобы быть доступным в фабрике vi.mock.
const pollState = vi.hoisted(() => ({ statusCalls: 0 }))

vi.mock('@/lib/dessly', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/dessly')>()
  return {
    ...actual,
    // Резолвим package_id (цена не важна — у товара ненулевая цена в БД).
    resolvePackage: async () => ({ packageId: 555, price: 0.98, region: 'RU', edition: 'Standard' }),
    // Свежий заказ принят, но ещё в обработке.
    sendGift: async () => ({ transactionId: 'tx-poll-1', status: 'pending' as const }),
    // Первый опрос — всё ещё pending, второй — completed (sent).
    getTransactionStatus: async () => {
      pollState.statusCalls += 1
      return {
        transactionId: 'tx-poll-1',
        status: (pollState.statusCalls >= 2 ? 'sent' : 'pending') as 'sent' | 'pending',
        giftLink: pollState.statusCalls >= 2 ? 'https://store.steampowered.com/gift/poll' : undefined,
      }
    },
  }
})

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

let currentUser: { id: string; email: string } | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser }, error: null }) },
  }),
}))

import { POST as ordersCreatePOST } from '@/app/api/orders/create/route'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/orders/create', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const createdUserIds: string[] = []
const createdProductIds: string[] = []
let categoryId: string | null = null
let zeroStatusId: string | null = null

async function seedUser(balance: number): Promise<{ id: string; email: string }> {
  const email = `vitest+poll-${randomUUID().slice(0, 8)}@nicetry.test`
  const { data, error } = await retry(() => admin.auth.admin.createUser({ email, email_confirm: true }))
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`)
  const id = data.user.id
  createdUserIds.push(id)
  await retry(() =>
    admin.from('users').upsert(
      {
        id,
        email,
        referral_code: `P${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`,
        balance,
        is_admin: false,
        status_id: zeroStatusId,
      },
      { onConflict: 'id' }
    )
  )
  return { id, email }
}

async function getBalance(id: string): Promise<number> {
  const { data } = await retry(() => admin.from('users').select('balance').eq('id', id).single())
  return Number(data!.balance)
}

beforeAll(async () => {
  const { data: cat } = await retry(() => admin.from('categories').select('id').limit(1).single())
  categoryId = cat?.id ?? null
  const { data: statuses } = await retry(() => admin.from('user_statuses').select('id, discount_percent'))
  for (const s of statuses || []) {
    if (Number(s.discount_percent) === 0) {
      zeroStatusId = s.id
      break
    }
  }
}, 60000)

afterAll(async () => {
  const ids = createdUserIds.splice(0)
  const del = (fn: () => PromiseLike<unknown>) => retry(fn, 3).catch(() => {})
  if (ids.length) {
    await del(() => admin.from('balance_transactions').delete().in('user_id', ids))
    await del(() => admin.from('orders').delete().in('user_id', ids))
    await del(() => admin.from('users').delete().in('id', ids))
    await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})))
  }
  const pids = createdProductIds.splice(0)
  if (pids.length) await del(() => admin.from('products').delete().in('id', pids))
}, 120000)

describe('Dessly polling: pending→completed не помечается failed раньше времени (Задача 7)', () => {
  it('заказ дожидается completed через паузы и становится delivered', async () => {
    pollState.statusCalls = 0
    const gameId = `dessly_vt_${randomUUID().slice(0, 8)}`
    const { data: game, error } = await retry(() =>
      admin
        .from('products')
        .insert({
          name: `VITEST Dessly poll ${randomUUID().slice(0, 6)}`,
          type: 'instant',
          category_id: categoryId,
          price: 1000, // ненулевая цена карточки → путь резолва цены не задействуем
          is_active: true,
          supplier: 'dessly',
          supplier_service_id: gameId,
          denomination_id: gameId,
        })
        .select()
        .single()
    )
    if (error || !game) throw new Error(`seed poll product: ${error?.message}`)
    createdProductIds.push(game.id)

    const user = await seedUser(5000)
    currentUser = user

    const res = await ordersCreatePOST(
      req({
        items: [{ product_id: game.id, quantity: 1, form_data: { recipient: 'https://s.team/p/abcd-1234', region: 'RU' } }],
        payment_method: 'balance',
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Был хотя бы один «пустой» опрос (pending), затем completed — заказ доведён до delivered.
    expect(pollState.statusCalls).toBeGreaterThanOrEqual(2)
    expect(body.order.status).toBe('delivered')
    expect(body.order.status).not.toBe('cancelled')
    expect(await getBalance(user.id)).toBe(5000 - 1000)

    const { data: items } = await retry(() => admin.from('order_items').select('*').eq('order_id', body.order.id))
    expect(items![0].delivery_status).toBe('delivered')
  }, 60000)
})
