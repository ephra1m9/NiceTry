import { describe, it, expect, vi } from 'vitest'
import { makeAdminClient, type MockDb } from '../helpers/supabase-mock'

// Юнит выдачи live-заказа (вебхук status: success && hold=0) → markOrderPaidAndDeliver.
// Проверяем главное: instant-товар получает НАСТОЯЩИЙ ключ из product_keys (не заглушку), и
// заказ доводится до 'delivered'; если ключей нет — позиция остаётся в обработке, заказ 'paid'.

// supabaseAdmin подменяем мок-клиентом с очередями результатов по таблицам (порядок = порядок
// терминальных вызовов: maybeSingle/await). db пересоздаётся в каждом тесте через mutable-ссылку.
let db: MockDb
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return makeAdminClient(db)
  },
}))

// AppRoute мокаем — проверяем, что вебхук-выдача реально дёргает поставщика, а не пишет заглушку.
const createShopOrder = vi.fn()
const waitForOrder = vi.fn()
const unhideVouchers = vi.fn()
vi.mock('@/lib/approute', () => ({
  createShopOrder: (...a: unknown[]) => createShopOrder(...(a as [])),
  waitForOrder: (...a: unknown[]) => waitForOrder(...(a as [])),
  unhideVouchers: (...a: unknown[]) => unhideVouchers(...(a as [])),
  AppRouteError: class AppRouteError extends Error {},
  AppRouteStatusCode: { UPSTREAM_ERROR: 'UPSTREAM_ERROR' },
}))

import { markOrderPaidAndDeliver } from '@/lib/payments/fulfillment'

describe('markOrderPaidAndDeliver (live выдача)', () => {
  it('instant: выдаёт реальный key_value и переводит заказ в delivered', async () => {
    db = {
      tables: {
        orders: [
          { data: { id: 'o1', status: 'new', promo_code_id: null } }, // поиск по invoice_id
          { data: [{ id: 'o1' }] }, // update new→paid ... .select('id')
          { data: null }, // update → delivered
        ],
        order_items: [
          { data: [{ id: 'it1', product_id: 'p1', quantity: 1, voucher_code: null, delivery_status: 'pending' }] },
          { data: null }, // update позиции (voucher_code/delivered)
        ],
        products: [{ data: { type: 'instant' } }],
        product_keys: [
          { data: { id: 'k1', key_value: '123' } }, // свободный ключ
          { data: null, error: null }, // update is_used=true
        ],
      },
      calls: [],
    }

    const res = await markOrderPaidAndDeliver('inv-1', 'uuid-1')
    expect(res).toMatchObject({ delivered: true, alreadyDelivered: false, orderId: 'o1' })

    // Позиция выдана РЕАЛЬНЫМ ключом, не заглушкой NT-xxxx.
    const itemUpdate = db.calls!.find(
      (c) => c.table === 'order_items' && c.op === 'update'
    )!
    expect(itemUpdate.payload).toMatchObject({ voucher_code: '123', delivery_status: 'delivered' })

    // Ключ помечен использованным.
    expect(db.calls).toContainEqual(
      expect.objectContaining({ table: 'product_keys', op: 'update' })
    )

    // Заказ доведён до delivered.
    const orderUpdates = db.calls!.filter((c) => c.table === 'orders' && c.op === 'update')
    expect(orderUpdates.some((c) => (c.payload as any)?.status === 'delivered')).toBe(true)
  })

  it('instant AppRoute: выдаёт коды поставщика (не заглушку) и переводит заказ в delivered', async () => {
    createShopOrder.mockResolvedValue({ data: { orderId: 'ao1' }, traceId: 'tr1' })
    waitForOrder.mockResolvedValue({ status: 'SUCCESS' })
    unhideVouchers.mockResolvedValue(['REAL-AR-CODE'])
    db = {
      tables: {
        orders: [
          { data: { id: 'o4', status: 'new', promo_code_id: null } },
          { data: [{ id: 'o4' }] },
          { data: null },
        ],
        order_items: [
          { data: [{ id: 'it4', product_id: 'p4', quantity: 1, voucher_code: null, delivery_status: 'pending' }] },
          { data: null }, // update позиции
        ],
        // Полная строка товара: instant + AppRoute → выдача через поставщика, без product_keys.
        products: [{ data: { id: 'p4', type: 'instant', supplier: 'approute', denomination_id: 'd4' } }],
      },
      calls: [],
    }

    const res = await markOrderPaidAndDeliver('inv-4', 'uuid-4')
    expect(res.delivered).toBe(true)
    expect(createShopOrder).toHaveBeenCalledWith('inv-4', 'd4', 1)

    const itemUpdate = db.calls!.find((c) => c.table === 'order_items' && c.op === 'update')!
    expect(itemUpdate.payload).toMatchObject({ voucher_code: 'REAL-AR-CODE', delivery_status: 'delivered' })
    const orderUpdates = db.calls!.filter((c) => c.table === 'orders' && c.op === 'update')
    expect(orderUpdates.some((c) => (c.payload as any)?.status === 'delivered')).toBe(true)
  })

  it('instant без свободных ключей: позиция остаётся в обработке, заказ не delivered', async () => {
    db = {
      tables: {
        orders: [
          { data: { id: 'o2', status: 'new', promo_code_id: null } },
          { data: [{ id: 'o2' }] },
        ],
        order_items: [
          { data: [{ id: 'it2', product_id: 'p2', quantity: 1, voucher_code: null, delivery_status: 'pending' }] },
        ],
        products: [{ data: { type: 'instant' } }],
        product_keys: [{ data: null }], // ключей нет
      },
      calls: [],
    }

    const res = await markOrderPaidAndDeliver('inv-2')
    expect(res.delivered).toBe(true) // переход new→paid состоялся

    // Позицию НЕ выдавали (нет update order_items).
    expect(db.calls!.some((c) => c.table === 'order_items' && c.op === 'update')).toBe(false)
    // Заказ НЕ переведён в delivered.
    const orderUpdates = db.calls!.filter((c) => c.table === 'orders' && c.op === 'update')
    expect(orderUpdates.some((c) => (c.payload as any)?.status === 'delivered')).toBe(false)
  })

  it('идемпотентность: заказ уже не new → выдача пропускается', async () => {
    db = {
      tables: {
        orders: [{ data: { id: 'o3', status: 'paid', promo_code_id: null } }],
      },
      calls: [],
    }
    const res = await markOrderPaidAndDeliver('inv-3')
    expect(res).toMatchObject({ delivered: false, alreadyDelivered: true, orderId: 'o3' })
    // Никаких выдач/обновлений ключей.
    expect(db.calls!.some((c) => c.op === 'update')).toBe(false)
  })
})
