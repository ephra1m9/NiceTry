import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { retry, sweepVitestRows } from '../helpers/live'

// ============================================================
// Боевой интеграционный тест полного цикла заказа (Контур B) против ЖИВОГО Supabase.
// Сессионный клиент мокается (getUser → тестовый пользователь), но ВСЯ остальная логика
// (supabaseAdmin, списание баланса, выдача через AppRoute-мок, скидки, промокоды, рефералка,
// гонки) выполняется по-настоящему против реальной БД и реального кода роута.
// ============================================================

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

// Текущий «залогиненный» пользователь для мокнутого сессионного клиента.
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

interface SeededUser {
  id: string
  email: string
}

const createdUserIds: string[] = []
const createdProductIds: string[] = []

async function seedUser(balance: number, opts: { statusId?: string | null; referredBy?: string | null } = {}): Promise<SeededUser> {
  const email = `vitest+ord-${randomUUID().slice(0, 8)}@nicetry.test`
  const { data, error } = await retry(() => admin.auth.admin.createUser({ email, email_confirm: true }))
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`)
  const id = data.user.id
  createdUserIds.push(id)
  const { error: insErr } = await retry(() =>
    admin.from('users').upsert(
      {
        id,
        email,
        referral_code: `O${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`,
        balance,
        is_admin: false,
        status_id: opts.statusId ?? null,
        referred_by: opts.referredBy ?? null,
      },
      { onConflict: 'id' }
    )
  )
  if (insErr) throw new Error(`insert users: ${insErr.message}`)
  return { id, email }
}

async function getBalance(id: string): Promise<number> {
  const { data } = await retry(() => admin.from('users').select('balance').eq('id', id).single())
  return Number(data!.balance)
}

// Реальные товары из БД.
let instantProduct: any
let topupProduct: any
let zeroStatusId: string | null = null
let discountStatus: { id: string; discount: number } | null = null

beforeAll(async () => {
  const { data: inst, error: e1 } = await retry(() =>
    admin
      .from('products')
      .select('*')
      .eq('type', 'instant')
      .eq('supplier', 'approute')
      .eq('is_active', true)
      .not('denomination_id', 'is', null)
      .limit(1)
  )
  if (e1) throw new Error(`products query: ${e1.message}`)
  if (!inst || inst.length === 0) throw new Error('Нет instant/approute товара в БД для теста')
  instantProduct = inst[0]

  const { data: top } = await retry(() =>
    admin.from('products').select('*').eq('type', 'topup_auto').eq('is_active', true).limit(1)
  )
  topupProduct = top && top[0]

  const { data: statuses } = await retry(() => admin.from('user_statuses').select('id, discount_percent'))
  for (const s of statuses || []) {
    if (Number(s.discount_percent) === 0 && !zeroStatusId) zeroStatusId = s.id
    if (Number(s.discount_percent) > 0 && !discountStatus) discountStatus = { id: s.id, discount: Number(s.discount_percent) }
  }
}, 60000)

afterAll(async () => {
  // Массовая, ограниченная по времени очистка: один запрос на таблицу (не на пользователя),
  // auth-пользователи — параллельно. Так afterAll не упирается в таймаут под сетевой латентностью.
  const ids = createdUserIds.splice(0)
  if (!ids.length) return
  const del = (fn: () => PromiseLike<unknown>) => retry(fn, 3).catch(() => {})
  await del(() => admin.from('referral_earnings').delete().in('referrer_id', ids))
  await del(() => admin.from('referral_earnings').delete().in('referred_user_id', ids))
  await del(() => admin.from('balance_transactions').delete().in('user_id', ids))
  await del(() => admin.from('orders').delete().in('user_id', ids)) // order_items cascade
  await del(() => admin.from('users').delete().in('id', ids))
  // Тестовые товары удаляем ПОСЛЕ заказов (order_items на них уже сняты каскадом).
  const pids = createdProductIds.splice(0)
  if (pids.length) await del(() => admin.from('products').delete().in('id', pids))
  await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})))
  // Подчистка возможных orphan-заказов (user_id обнулён) — best effort.
  await del(() => admin.from('orders').delete().is('user_id', null))
  await sweepVitestRows(admin)
}, 120000)

describe('Заказ с баланса — успешная выдача (instant/AppRoute)', () => {
  it('списывает баланс, выдаёт voucher, переводит заказ в delivered, пишет транзакцию', async () => {
    const price = Number(instantProduct.price)
    const user = await seedUser(price + 1000, { statusId: zeroStatusId })
    currentUser = user

    const res = await ordersCreatePOST(
      req({ items: [{ product_id: instantProduct.id, quantity: 1 }], payment_method: 'balance' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.order.final_amount).toBe(price)
    expect(body.order.status).toBe('delivered')
    expect(body.order.delivered_items).toHaveLength(1)
    // Код раскрыт (не маскирован).
    expect(body.order.delivered_items[0].voucher_code).not.toMatch(/^\*\*\*\*/)

    // Баланс списан ровно на price.
    expect(await getBalance(user.id)).toBe(1000)

    // Транзакция списания создана.
    const { data: txns } = await retry(() =>
      admin.from('balance_transactions').select('*').eq('user_id', user.id).eq('type', 'purchase')
    )
    expect(txns!.length).toBe(1)
    expect(Number(txns![0].amount)).toBe(-price)

    // Заказ в БД — delivered, voucher сохранён в позиции.
    const { data: orderRow } = await retry(() => admin.from('orders').select('*').eq('id', body.order.id).single())
    expect(orderRow!.status).toBe('delivered')
    const { data: itemRows } = await retry(() => admin.from('order_items').select('*').eq('order_id', body.order.id))
    expect(itemRows![0].delivery_status).toBe('delivered')
    expect(itemRows![0].voucher_code).toBeTruthy()
  }, 60000)
})

describe('Заказ с баланса — недостаточно средств', () => {
  it('возвращает 400 и НЕ списывает баланс, НЕ создаёт заказ', async () => {
    const user = await seedUser(10, { statusId: zeroStatusId }) // мало
    currentUser = user
    const res = await ordersCreatePOST(
      req({ items: [{ product_id: instantProduct.id, quantity: 1 }], payment_method: 'balance' })
    )
    expect(res.status).toBe(400)
    expect(await getBalance(user.id)).toBe(10)
    const { count } = await retry(() =>
      admin.from('orders').select('*', { head: true, count: 'exact' }).eq('user_id', user.id)
    )
    expect(count).toBe(0)
  }, 60000)
})

describe('Скидка по статусу пользователя', () => {
  it('применяет процент скидки статуса к сумме заказа', async () => {
    if (!discountStatus) {
      throw new Error('Нет статуса со скидкой >0 в БД — тест требует данных user_statuses')
    }
    const price = Number(instantProduct.price)
    const user = await seedUser(price + 1000, { statusId: discountStatus.id })
    currentUser = user
    const res = await ordersCreatePOST(
      req({ items: [{ product_id: instantProduct.id, quantity: 1 }], payment_method: 'balance' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const expectedDiscount = Math.round((price * discountStatus.discount) / 100)
    expect(body.order.discount_amount).toBe(expectedDiscount)
    expect(body.order.final_amount).toBe(price - expectedDiscount)
  }, 60000)
})

describe('Промокод (процент) + инкремент счётчика использований', () => {
  it('применяет скидку промокода и увеличивает used_count', async () => {
    const price = Number(instantProduct.price)
    const code = `VT${randomUUID().slice(0, 6).toUpperCase()}`
    const { data: promo } = await retry(() =>
      admin
        .from('promo_codes')
        .insert({ code, discount_type: 'percent', discount_value: 10, is_active: true, used_count: 0 })
        .select()
        .single()
    )

    try {
      const user = await seedUser(price + 1000, { statusId: zeroStatusId })
      currentUser = user
      const res = await ordersCreatePOST(
        req({
          items: [{ product_id: instantProduct.id, quantity: 1 }],
          payment_method: 'balance',
          promo_code: code,
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.order.discount_amount).toBe(Math.round((price * 10) / 100))

      const { data: pc } = await retry(() =>
        admin.from('promo_codes').select('used_count').eq('id', promo!.id).single()
      )
      expect(Number(pc!.used_count)).toBe(1)
    } finally {
      await admin.from('orders').update({ promo_code_id: null }).eq('promo_code_id', promo!.id)
      await admin.from('promo_codes').delete().eq('id', promo!.id)
    }
  }, 60000)
})

describe('Пополнение (topup_auto) — ручной поток, статус paid', () => {
  it('списывает введённую сумму, заказ остаётся paid, позиция pending', async () => {
    if (!topupProduct) throw new Error('Нет topup_auto товара в БД')
    const amount = Number(topupProduct.min_amount) + 100
    const user = await seedUser(amount + 1000, { statusId: zeroStatusId })
    currentUser = user
    const res = await ordersCreatePOST(
      req({
        items: [{ product_id: topupProduct.id, custom_amount: amount, form_data: { account_reference: 'player1' } }],
        payment_method: 'balance',
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.final_amount).toBe(amount)
    expect(body.order.status).toBe('paid') // не моментальная выдача
    expect(await getBalance(user.id)).toBe(1000)
  }, 60000)

  it('сумма ниже минимума → 400', async () => {
    if (!topupProduct) throw new Error('Нет topup_auto товара в БД')
    const user = await seedUser(100000, { statusId: zeroStatusId })
    currentUser = user
    const res = await ordersCreatePOST(
      req({
        items: [{ product_id: topupProduct.id, custom_amount: 1 }],
        payment_method: 'balance',
      })
    )
    expect(res.status).toBe(400)
  }, 60000)
})

describe('Гонка / двойное нажатие — баланс не уходит в минус, товар не выдаётся дважды', () => {
  it('два параллельных одинаковых заказа при балансе на ОДИН: ровно один успех, баланс ≥ 0', async () => {
    const price = Number(instantProduct.price)
    const user = await seedUser(price, { statusId: zeroStatusId }) // хватает ровно на 1
    currentUser = user

    const [r1, r2] = await Promise.all([
      ordersCreatePOST(req({ items: [{ product_id: instantProduct.id, quantity: 1 }], payment_method: 'balance' })),
      ordersCreatePOST(req({ items: [{ product_id: instantProduct.id, quantity: 1 }], payment_method: 'balance' })),
    ])
    const statuses = [r1.status, r2.status].sort()
    const successCount = [r1.status, r2.status].filter((s) => s === 200).length

    // Ровно один заказ оплачен; второй отклонён (409 гонка или 400 нехватка).
    expect(successCount).toBe(1)
    expect(statuses).toContain(200)

    // Баланс не отрицательный и списан ровно на одну покупку.
    const bal = await getBalance(user.id)
    expect(bal).toBeGreaterThanOrEqual(0)
    expect(bal).toBe(0)

    // Доставлен ровно один заказ.
    const { count: deliveredCount } = await retry(() =>
      admin.from('orders').select('*', { head: true, count: 'exact' }).eq('user_id', user.id).eq('status', 'delivered')
    )
    expect(deliveredCount).toBe(1)
  }, 60000)
})

describe('Сбой выдачи у поставщика → возврат на баланс, заказ cancelled (ТЗ §5.4)', () => {
  it('AppRoute OUT_OF_STOCK: баланс возвращается, заказ cancelled, позиция failed, есть транзакция refund', async () => {
    // Товар с denomination_id force_OUT_OF_STOCK → мок AppRoute бросает ошибку при выдаче.
    const { data: forceProduct, error: pErr } = await retry(() =>
      admin
        .from('products')
        .insert({
          name: `VITEST force OUT_OF_STOCK ${randomUUID().slice(0, 6)}`,
          description: 'vitest',
          type: 'instant',
          category_id: instantProduct.category_id,
          price: 500,
          stock: 100,
          is_active: true,
          supplier: 'approute',
          supplier_service_id: 'svc_vitest_force',
          denomination_id: 'force_OUT_OF_STOCK',
        })
        .select()
        .single()
    )
    if (pErr || !forceProduct) throw new Error(`seed force product: ${pErr?.message}`)
    createdProductIds.push(forceProduct.id)

    const user = await seedUser(2000, { statusId: zeroStatusId })
    currentUser = user

    const res = await ordersCreatePOST(
      req({ items: [{ product_id: forceProduct.id, quantity: 1 }], payment_method: 'balance' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.status).toBe('cancelled')
    expect(body.order.delivered_items).toHaveLength(0)

    // Баланс вернулся к исходному (списали 500 → вернули 500).
    expect(await getBalance(user.id)).toBe(2000)

    // Есть транзакция списания и транзакция возврата.
    const { data: txns } = await retry(() =>
      admin.from('balance_transactions').select('*').eq('user_id', user.id)
    )
    const purchase = txns!.find((t) => t.type === 'purchase')
    const refund = txns!.find((t) => t.type === 'refund')
    expect(Number(purchase!.amount)).toBe(-500)
    expect(Number(refund!.amount)).toBe(500)

    // Позиция помечена failed, заказ cancelled в БД.
    const { data: items } = await retry(() => admin.from('order_items').select('*').eq('order_id', body.order.id))
    expect(items![0].delivery_status).toBe('failed')
    const { data: orderRow } = await retry(() => admin.from('orders').select('status').eq('id', body.order.id).single())
    expect(orderRow!.status).toBe('cancelled')
  }, 60000)
})

describe('Dessly — отправка игры гифтом (Блок B3)', () => {
  // Seed-хелпер: реальный dessly-товар в БД (как сидит seed.mjs: denomination_id = id игры).
  async function seedDesslyProduct(): Promise<any> {
    // denomination_id = id игры по конвенции dessly_* (как сидит seed.mjs) — резолвится в package_id.
    const gameId = `dessly_vt_${randomUUID().slice(0, 8)}`
    const { data, error } = await retry(() =>
      admin
        .from('products')
        .insert({
          name: `VITEST Dessly game ${randomUUID().slice(0, 6)}`,
          description: 'vitest',
          type: 'instant',
          category_id: instantProduct.category_id,
          price: 1500,
          stock: 50,
          is_active: true,
          supplier: 'dessly',
          supplier_service_id: gameId,
          denomination_id: gameId,
        })
        .select()
        .single()
    )
    if (error || !data) throw new Error(`seed dessly product: ${error?.message}`)
    createdProductIds.push(data.id)
    return data
  }

  it('валидный Steam invite: гифт отправлен (мок), заказ delivered, voucher = giftLink', async () => {
    const game = await seedDesslyProduct()
    const user = await seedUser(5000, { statusId: zeroStatusId })
    currentUser = user

    const res = await ordersCreatePOST(
      req({
        items: [{ product_id: game.id, quantity: 1, form_data: { recipient: 'https://s.team/p/abcd-1234', region: 'RU' } }],
        payment_method: 'balance',
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.status).toBe('delivered')
    expect(body.order.delivered_items).toHaveLength(1)
    // Мок sendGift возвращает giftLink — он и попадает в voucher_code.
    expect(body.order.delivered_items[0].voucher_code).toContain('steampowered.com/gift')
    expect(await getBalance(user.id)).toBe(5000 - 1500)
  }, 60000)

  it('некорректный invite: выдачи нет, заказ cancelled, баланс возвращён (refund)', async () => {
    const game = await seedDesslyProduct()
    const user = await seedUser(5000, { statusId: zeroStatusId })
    currentUser = user

    const res = await ordersCreatePOST(
      req({
        items: [{ product_id: game.id, quantity: 1, form_data: { recipient: 'https://example.com/not-an-invite' } }],
        payment_method: 'balance',
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.status).toBe('cancelled')
    expect(body.order.delivered_items).toHaveLength(0)
    // Списали 1500 → вернули 1500.
    expect(await getBalance(user.id)).toBe(5000)
    const { data: txns } = await retry(() =>
      admin.from('balance_transactions').select('*').eq('user_id', user.id)
    )
    expect(txns!.find((t) => t.type === 'refund')).toBeTruthy()
    const { data: items } = await retry(() => admin.from('order_items').select('*').eq('order_id', body.order.id))
    expect(items![0].delivery_status).toBe('failed')
  }, 60000)

  // Задача 6: живой каталог игр Dessly цену НЕ отдаёт (price=0 в карточке). Цена должна
  // браться из издания/региона (getGame/resolvePackage), а заказ НИКОГДА не проходить с 0.
  it('цена Dessly берётся из издания/региона при нулевой цене карточки (не 0)', async () => {
    // Товар с НУЛЕВОЙ ценой в БД — как у боевого Dessly (games не несёт цену).
    const gameId = `dessly_vt_${randomUUID().slice(0, 8)}`
    const { data: game, error } = await retry(() =>
      admin
        .from('products')
        .insert({
          name: `VITEST Dessly zero-price ${randomUUID().slice(0, 6)}`,
          type: 'instant',
          category_id: instantProduct.category_id,
          price: 0, // ← цена из карточки = 0
          is_active: true,
          supplier: 'dessly',
          supplier_service_id: gameId,
          denomination_id: gameId,
        })
        .select()
        .single()
    )
    if (error || !game) throw new Error(`seed zero-price dessly: ${error?.message}`)
    createdProductIds.push(game.id)

    const user = await seedUser(5000, { statusId: zeroStatusId })
    currentUser = user

    const res = await ordersCreatePOST(
      req({
        items: [{ product_id: game.id, quantity: 1, form_data: { recipient: 'https://s.team/p/abcd-1234', region: 'RU' } }],
        payment_method: 'balance',
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Ключевое: итоговая сумма НЕ ноль — она пришла из издания/региона, а не из карточки.
    expect(body.order.final_amount).toBeGreaterThan(0)
    expect(body.order.total_amount).toBeGreaterThan(0)
    expect(body.order.status).toBe('delivered')
    // Баланс уменьшился ровно на ненулевую итоговую сумму.
    expect(await getBalance(user.id)).toBe(5000 - Number(body.order.final_amount))
  }, 60000)

  it('guard: недоступный регион → заказ не проводится (ошибка), баланс не списан', async () => {
    const gameId = `dessly_vt_${randomUUID().slice(0, 8)}`
    const { data: game, error } = await retry(() =>
      admin
        .from('products')
        .insert({
          name: `VITEST Dessly badregion ${randomUUID().slice(0, 6)}`,
          type: 'instant',
          category_id: instantProduct.category_id,
          price: 0,
          is_active: true,
          supplier: 'dessly',
          supplier_service_id: gameId,
          denomination_id: gameId,
        })
        .select()
        .single()
    )
    if (error || !game) throw new Error(`seed badregion dessly: ${error?.message}`)
    createdProductIds.push(game.id)

    const user = await seedUser(5000, { statusId: zeroStatusId })
    currentUser = user

    const res = await ordersCreatePOST(
      req({
        items: [{ product_id: game.id, quantity: 1, form_data: { recipient: 'https://s.team/p/abcd-1234', region: 'ZZ' } }],
        payment_method: 'balance',
      })
    )
    // Цена не резолвится (нет такого региона) → 400, заказ не создаётся, деньги на месте.
    expect(res.status).toBe(400)
    expect(await getBalance(user.id)).toBe(5000)
  }, 60000)
})

describe('Реферальные начисления + защита от самореферала', () => {
  it('начисляет бонус рефереру за заказ приглашённого', async () => {
    const referrer = await seedUser(0, { statusId: zeroStatusId })
    const price = Number(instantProduct.price)
    const buyer = await seedUser(price + 1000, { statusId: zeroStatusId, referredBy: referrer.id })
    currentUser = buyer

    const res = await ordersCreatePOST(
      req({ items: [{ product_id: instantProduct.id, quantity: 1 }], payment_method: 'balance' })
    )
    expect(res.status).toBe(200)

    // У реферера появился положительный баланс и запись referral_earnings.
    const refBal = await getBalance(referrer.id)
    expect(refBal).toBeGreaterThan(0)
    const { count } = await retry(() =>
      admin.from('referral_earnings').select('*', { head: true, count: 'exact' }).eq('referrer_id', referrer.id)
    )
    expect(count).toBe(1)
  }, 60000)

  it('самореферал не начисляет бонус (referred_by == свой id)', async () => {
    const price = Number(instantProduct.price)
    const user = await seedUser(price + 1000, { statusId: zeroStatusId })
    // Делаем пользователя реферером самого себя.
    await retry(() => admin.from('users').update({ referred_by: user.id }).eq('id', user.id))
    currentUser = user

    const balanceBefore = await getBalance(user.id)
    const res = await ordersCreatePOST(
      req({ items: [{ product_id: instantProduct.id, quantity: 1 }], payment_method: 'balance' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Баланс уменьшился ровно на цену (никаких самопремий не прибавилось).
    expect(await getBalance(user.id)).toBe(balanceBefore - Number(body.order.final_amount))
    const { count } = await retry(() =>
      admin.from('referral_earnings').select('*', { head: true, count: 'exact' }).eq('referrer_id', user.id)
    )
    expect(count).toBe(0)
  }, 60000)
})
