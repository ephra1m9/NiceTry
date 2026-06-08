import { describe, it, expect, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

// Тест обработчика вебхука pay4game: подпись (raw body), идемпотентность, проверка hold,
// выдача заказа ТОЛЬКО при success && hold=0. БД и выдача мокаются — проверяем именно логику роута.

const SECRET = 'test-secret-key-pay4game'
beforeAll(() => {
  process.env.PAY4GAME_API_TOKEN = 'test-token'
  process.env.PAY4GAME_SECRET_KEY = SECRET
  process.env.PAY4GAME_PROJECT_ID = 'test-project'
})

// Управляемые моки слоя БД/выдачи.
const recordWebhook = vi.fn(async () => ({ alreadyProcessed: false }))
const markWebhookProcessed = vi.fn(async () => {})
const updatePayment = vi.fn(async () => {})
const markOrderPaidAndDeliver = vi.fn(async () => ({ delivered: true, alreadyDelivered: false }))

vi.mock('@/lib/payments/db', () => ({
  recordWebhook: (...a: unknown[]) => recordWebhook(...(a as [])),
  markWebhookProcessed: (...a: unknown[]) => markWebhookProcessed(...(a as [])),
  updatePayment: (...a: unknown[]) => updatePayment(...(a as [])),
}))
vi.mock('@/lib/payments/fulfillment', () => ({
  markOrderPaidAndDeliver: (...a: unknown[]) => markOrderPaidAndDeliver(...(a as [])),
}))

import { POST as webhookPOST } from '@/app/api/pay4game/webhook/route'

function sign(raw: string): string {
  return createHmac('sha256', SECRET).update(raw).digest('hex')
}
function req(raw: string, signature?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== undefined) headers['x-request-signature'] = signature
  return new NextRequest('http://localhost/api/pay4game/webhook', { method: 'POST', body: raw, headers })
}

describe('pay4game webhook', () => {
  it('невалидная подпись → 200 ignored, без обработки', async () => {
    recordWebhook.mockClear()
    markOrderPaidAndDeliver.mockClear()
    const raw = JSON.stringify({ type: 'status', invoice_id: 'inv1', status: 'success', hold: 0 })
    const res = await webhookPOST(req(raw, 'deadbeef'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ignored: true })
    expect(recordWebhook).not.toHaveBeenCalled()
    expect(markOrderPaidAndDeliver).not.toHaveBeenCalled()
  })

  it('status success + hold=0 → выдача заказа', async () => {
    markOrderPaidAndDeliver.mockClear()
    updatePayment.mockClear()
    const raw = JSON.stringify({ type: 'status', invoice_id: 'inv2', uuid: 'u2', amount: 100, status: 'success', hold: 0 })
    const res = await webhookPOST(req(raw, sign(raw)))
    expect(res.status).toBe(200)
    expect(updatePayment).toHaveBeenCalled()
    expect(markOrderPaidAndDeliver).toHaveBeenCalledWith('inv2', 'u2')
  })

  it('status success + hold=1 → НЕ выдаём (ждём повторный вебхук)', async () => {
    markOrderPaidAndDeliver.mockClear()
    const raw = JSON.stringify({ type: 'status', invoice_id: 'inv3', uuid: 'u3', amount: 100, status: 'success', hold: 1 })
    const res = await webhookPOST(req(raw, sign(raw)))
    expect(res.status).toBe(200)
    expect(markOrderPaidAndDeliver).not.toHaveBeenCalled()
  })

  it('declined → НЕ выдаём', async () => {
    markOrderPaidAndDeliver.mockClear()
    const raw = JSON.stringify({ type: 'status', invoice_id: 'inv4', status: 'declined', hold: 0 })
    const res = await webhookPOST(req(raw, sign(raw)))
    expect(res.status).toBe(200)
    expect(markOrderPaidAndDeliver).not.toHaveBeenCalled()
  })

  it('идемпотентность: уже обработанный вебхук → пропуск', async () => {
    recordWebhook.mockResolvedValueOnce({ alreadyProcessed: true })
    markOrderPaidAndDeliver.mockClear()
    const raw = JSON.stringify({ type: 'status', invoice_id: 'inv2', uuid: 'u2', status: 'success', hold: 0 })
    const res = await webhookPOST(req(raw, sign(raw)))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ duplicate: true })
    expect(markOrderPaidAndDeliver).not.toHaveBeenCalled()
  })

  it('inform → сохраняем qr (без выдачи)', async () => {
    updatePayment.mockClear()
    markOrderPaidAndDeliver.mockClear()
    const raw = JSON.stringify({ type: 'inform', invoice_id: 'inv5', uuid: 'u5', qr: { content: 'https://qr.nspk.ru/X', img: 'iVBOR' } })
    const res = await webhookPOST(req(raw, sign(raw)))
    expect(res.status).toBe(200)
    expect(updatePayment).toHaveBeenCalledWith('inv5', expect.objectContaining({ qr_content: 'https://qr.nspk.ru/X' }))
    expect(markOrderPaidAndDeliver).not.toHaveBeenCalled()
  })

  it('временная ошибка обработки → 500 (ретрай)', async () => {
    updatePayment.mockRejectedValueOnce(new Error('db down'))
    const raw = JSON.stringify({ type: 'status', invoice_id: 'inv6', status: 'success', hold: 0 })
    const res = await webhookPOST(req(raw, sign(raw)))
    expect(res.status).toBe(500)
  })
})
