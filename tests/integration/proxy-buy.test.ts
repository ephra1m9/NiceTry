import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeSessionClient, makeAdminClient, type MockDb } from '../helpers/supabase-mock'

// ============================================================
// Герметичный тест роута /api/proxy/buy: мокаем сессию, supabaseAdmin (lightweight builder),
// px6-клиент и proxy-pricing.loadProxySettings. Проверяем: успех (списание+выдача), нехватка
// баланса, нехватка средств px6 (возврат), идемпотентность (дубль), ошибка px6 (возврат).
// ============================================================

let currentUser: { id: string; email?: string } | null = { id: 'user-1', email: 'u@test' }
let db: MockDb = {}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => makeSessionClient({ user: currentUser, db }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return makeAdminClient(db)
  },
}))

// Мокаем px6 и настройки прокси. Фабрика vi.mock хоистится — переменные внутри объявляем здесь.
vi.mock('@/lib/px6', () => {
  class Px6Error extends Error {
    errorId: number
    status: number
    constructor(m: string, errorId: number, status = 0) {
      super(m)
      this.errorId = errorId
      this.status = status
    }
  }
  return {
    buy: vi.fn(),
    getCount: vi.fn(async () => 100),
    getPrice: vi.fn(async () => ({ price: 100, priceSingle: 20, period: 30, count: 5, currency: 'RUB' })),
    isValidVersion: (v: unknown) => v === 3 || v === 4 || v === 5 || v === 6,
    isPx6InsufficientFunds: (e: unknown) => e instanceof Px6Error && e.errorId === 400,
    Px6Error,
  }
})

vi.mock('@/lib/proxy-pricing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/proxy-pricing')>('@/lib/proxy-pricing')
  return {
    ...actual,
    loadProxySettings: vi.fn(async () => ({
      markup_percent: 30,
      usd_to_rub_rate: 100,
      is_enabled: true,
      allowed_periods: [7, 14, 30, 90],
      max_count: 50,
    })),
  }
})

import { POST } from '@/app/api/proxy/buy/route'
import * as px6 from '@/lib/px6'

const mockBuy = vi.mocked(px6.buy)
const mockGetCount = vi.mocked(px6.getCount)
const mockGetPrice = vi.mocked(px6.getPrice)

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/proxy/buy', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const baseBody = { version: 4, country: 'ru', count: 5, period: 30, idempotency_key: 'idem-key-123456' }
const mockProxies = [
  { id: '1', ip: '1.2.3.4', host: '1.2.3.4', port: '8080', user: 'u', pass: 'p', type: 'http', country: 'ru', date: 'd', dateEnd: 'de', descr: 'idem-key-123456', active: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  currentUser = { id: 'user-1', email: 'u@test' }
  mockGetCount.mockResolvedValue(100)
  mockGetPrice.mockResolvedValue({ price: 100, priceSingle: 20, period: 30, count: 5, currency: 'RUB' })
})

describe('/api/proxy/buy', () => {
  it('401 без авторизации', async () => {
    currentUser = null
    const res = await POST(req(baseBody))
    expect(res.status).toBe(401)
  })

  it('успех: цена 130₽ (100×1.3), списание и выдача прокси', async () => {
    mockBuy.mockResolvedValue({
      orderId: 'px6-1', count: 5, price: 100, period: 30, country: 'ru', currency: 'RUB', balance: 900, proxies: mockProxies,
    })
    db = {
      tables: {
        proxy_orders: [
          { data: null, error: null }, // idempotency lookup → нет
          { data: { id: 'order-1' }, error: null }, // claim insert
          { data: null, error: null }, // update → paid
        ],
        users: [
          { data: { id: 'user-1', balance: 1000 }, error: null }, // profile
          { data: { id: 'user-1' }, error: null }, // CAS debit ok
        ],
        balance_transactions: { data: null, error: null },
      },
    }
    const res = await POST(req(baseBody))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.price).toBe(130)
    expect(json.proxies).toHaveLength(1)
    expect(mockBuy).toHaveBeenCalledWith(expect.objectContaining({ descr: 'idem-key-123456' }))
  })

  it('недостаточно средств у пользователя → 400, px6.buy не вызывается', async () => {
    db = {
      tables: {
        proxy_orders: { data: null, error: null },
        users: { data: { id: 'user-1', balance: 50 }, error: null },
      },
    }
    const res = await POST(req(baseBody))
    expect(res.status).toBe(400)
    expect(mockBuy).not.toHaveBeenCalled()
  })

  it('идемпотентность: существующий paid-заказ → duplicate', async () => {
    db = {
      tables: {
        proxy_orders: { data: { id: 'order-x', status: 'paid', proxies: mockProxies, price_internal: 130 }, error: null },
      },
    }
    const res = await POST(req(baseBody))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.duplicate).toBe(true)
    expect(mockBuy).not.toHaveBeenCalled()
  })

  it('нехватка средств на px6 (error 400) → возврат и 503', async () => {
    mockBuy.mockRejectedValue(new px6.Px6Error('no money', 400, 200))
    db = {
      tables: {
        proxy_orders: [
          { data: null, error: null },
          { data: { id: 'order-2' }, error: null },
          { data: null, error: null }, // refund: update status
        ],
        users: [
          { data: { id: 'user-1', balance: 1000 }, error: null }, // profile
          { data: { id: 'user-1' }, error: null }, // debit ok
          { data: { balance: 870 }, error: null }, // refund: read balance
          { data: null, error: null }, // refund: update balance
        ],
        balance_transactions: { data: null, error: null },
      },
    }
    const res = await POST(req(baseBody))
    expect(res.status).toBe(503)
    // Возврат: была операция refund в balance_transactions.
    const refund = db.calls?.find((c) => c.table === 'balance_transactions' && (c.payload as any)?.type === 'refund')
    expect(refund).toBeTruthy()
  })

  it('px6 вернул успех без прокси → возврат и 502', async () => {
    mockBuy.mockResolvedValue({ count: 0, price: 0, period: 30, country: 'ru', currency: 'RUB', balance: 900, proxies: [] })
    db = {
      tables: {
        proxy_orders: [
          { data: null, error: null },
          { data: { id: 'order-3' }, error: null },
          { data: null, error: null },
        ],
        users: [
          { data: { id: 'user-1', balance: 1000 }, error: null },
          { data: { id: 'user-1' }, error: null },
          { data: { balance: 870 }, error: null },
          { data: null, error: null },
        ],
        balance_transactions: { data: null, error: null },
      },
    }
    const res = await POST(req(baseBody))
    expect(res.status).toBe(502)
  })

  it('нет в наличии (getCount < count) → 409', async () => {
    mockGetCount.mockResolvedValue(2)
    db = {
      tables: {
        proxy_orders: { data: null, error: null },
      },
    }
    const res = await POST(req(baseBody))
    expect(res.status).toBe(409)
    expect(mockBuy).not.toHaveBeenCalled()
  })

  it('невалидная версия → 400', async () => {
    const res = await POST(req({ ...baseBody, version: 99 }))
    expect(res.status).toBe(400)
  })
})
