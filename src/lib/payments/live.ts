// БОЕВАЯ реализация платежа (PAYMENTS_MODE=live) через pay4game.
//
// КОНТРАКТ: возвращает PaymentResult со статусом 'pending' — платёж СОЗДАН в pay4game, но НЕ
// подтверждён. Финальное «оплачено» приходит АСИНХРОННО из вебхука status (success && hold=0),
// см. src/app/api/pay4game/webhook/route.ts. Здесь заказ НЕ выдаётся.
//
// Поток после оплаты (ник → авто-вход → ЛК) остаётся прежним — он триггерится фактом успешного
// платежа (вебхук помечает заказ paid; пользователь возвращается на return_url/страницу статуса).
//
// invoice_id для pay4game = orderId (наш supplier_reference_id заказа). По нему вебхук/return/
// поллинг находят заказ.

import type { PaymentOrderInput, PaymentResult } from './index'
import { paymentCreate, getPay4gameConfig, Pay4gameError } from './pay4game'

export async function createLivePayment(input: PaymentOrderInput): Promise<PaymentResult> {
  // fail-fast: бросит понятную ошибку, если ключи не заданы.
  const cfg = getPay4gameConfig()

  try {
    const res = await paymentCreate(
      {
        invoiceId: input.orderId,
        amount: input.amount,
        email: input.email,
        method: input.method,
        clientIp: input.clientIp,
        steamAccount: input.steamAccount,
        steamAmount: input.steamAmount,
        description: input.description,
      },
      cfg
    )

    if (!res?.success || !res.uuid) {
      return {
        status: 'failed',
        paymentId: '',
        mode: 'live',
        demo: false,
        error: 'pay4game не создал платёж',
      }
    }

    return {
      status: 'pending',
      paymentId: res.uuid,
      mode: 'live',
      demo: false,
      uuid: res.uuid,
      url: res.url,
      // qrContent/qrImg придут позже в вебхуке inform (sbp+qr) — здесь их ещё нет.
    }
  } catch (e) {
    const msg = e instanceof Pay4gameError ? `pay4game: ${e.message}` : 'Не удалось создать платёж'
    console.error('[payments/live] paymentCreate failed:', e)
    return { status: 'failed', paymentId: '', mode: 'live', demo: false, error: msg }
  }
}
