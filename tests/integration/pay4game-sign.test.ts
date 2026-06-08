import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  signPay4game,
  signPaymentCreate,
  signPayoutSbp,
  signPayoutCard,
  verifyWebhookSignature,
  formatAmount,
} from '@/lib/payments/pay4game'

// Подписи pay4game — HMAC-SHA256(secret, data) → hex. Эталон считаем независимо тем же crypto,
// чтобы проверить формулы/разделители/формат суммы (см. PDF, разделы 2/4/6).
const SECRET = 'F9s57vYDzuZIbrXtF42wSHpWbsfJBJeiCHngFn75wKXc5test'
const hmac = (data: string) => createHmac('sha256', SECRET).update(data).digest('hex')

describe('pay4game signatures', () => {
  it('formatAmount всегда 2 знака', () => {
    expect(formatAmount(100)).toBe('100.00')
    expect(formatAmount(31.5)).toBe('31.50')
    expect(formatAmount(1581.5)).toBe('1581.50')
  })

  it('signPay4game = HMAC-SHA256 hex', () => {
    expect(signPay4game('hello', SECRET)).toBe(hmac('hello'))
  })

  it('payment/create: invoice_id:amount:email', () => {
    const inv = '15ca426e-df6c-445f-8291-c172ffa8c251'
    const amount = formatAmount(31.5) // "31.50"
    const email = 'test@example.com'
    expect(signPaymentCreate(inv, amount, email, SECRET)).toBe(hmac(`${inv}:${amount}:${email}`))
  })

  it('payout sbp: invoice_id:amount:phone', () => {
    expect(signPayoutSbp('1212', '1581.50', '79991234567', SECRET)).toBe(hmac('1212:1581.50:79991234567'))
  })

  it('payout card: invoice_id:amount:card_number', () => {
    expect(signPayoutCard('1212', '1581.50', '2200123456789012', SECRET)).toBe(
      hmac('1212:1581.50:2200123456789012')
    )
  })

  it('verifyWebhookSignature: по сырому телу, constant-time', () => {
    const raw = JSON.stringify({ type: 'status', invoice_id: '1212', status: 'success', hold: 0 })
    const good = hmac(raw)
    expect(verifyWebhookSignature(raw, good, SECRET)).toBe(true)
    expect(verifyWebhookSignature(raw, good.toUpperCase(), SECRET)).toBe(false) // регистр важен (hex lower)
    expect(verifyWebhookSignature(raw, 'deadbeef', SECRET)).toBe(false)
    expect(verifyWebhookSignature(raw, null, SECRET)).toBe(false)
    expect(verifyWebhookSignature(raw + ' ', good, SECRET)).toBe(false) // изменили тело → подпись не сходится
  })
})
