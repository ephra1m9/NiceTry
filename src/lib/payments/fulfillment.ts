// Выдача заказа после ПОДТВЕРЖДЁННОЙ оплаты (вебхук status: success && hold=0).
//
// ВАЖНО (live): выдача происходит ТОЛЬКО здесь, из обработчика вебхука — не синхронно при
// создании платежа. Идемпотентно: переход выполняется только из статуса 'new' → 'paid',
// повторные вебхуки/ретраи ничего не дублируют.
//
// ОБЛАСТЬ: как и гостевой mock-чекаут, эта выдача НЕ дёргает поставщиков (AppRoute/Dessly) —
// заказ помечается оплаченным, позиции получают код. Реальное исполнение через поставщиков —
// отдельный слой (см. /api/orders/create) и в задачу платёжной интеграции не входит.

import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface DeliverResult {
  delivered: boolean
  alreadyDelivered: boolean
  orderId?: string
}

/**
 * Найти заказ по invoice_id (= orders.supplier_reference_id), пометить оплаченным и выдать позиции.
 * Возвращает alreadyDelivered=true, если заказ уже не в статусе 'new' (идемпотентность).
 */
export async function markOrderPaidAndDeliver(invoiceId: string, paymentUuid?: string): Promise<DeliverResult> {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, status, promo_code_id')
    .eq('supplier_reference_id', invoiceId)
    .maybeSingle()

  if (!order) {
    console.warn('[payments/fulfillment] заказ не найден по invoice_id', invoiceId)
    return { delivered: false, alreadyDelivered: false }
  }

  // Идемпотентность: выдаём только из 'new'. Уже оплаченный/выданный — пропускаем.
  if (order.status !== 'new') {
    return { delivered: false, alreadyDelivered: true, orderId: order.id }
  }

  // Переводим в paid. Условие на status='new' защищает от гонки параллельных вебхуков.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('orders')
    .update({ status: 'paid', supplier_trace_id: paymentUuid ?? null })
    .eq('id', order.id)
    .eq('status', 'new')
    .select('id')
  if (updErr) {
    console.error('[payments/fulfillment] update order paid failed:', updErr)
    throw new Error('order update failed') // → 5xx → ретрай вебхука
  }
  if (!updated || updated.length === 0) {
    // Кто-то уже перевёл (гонка) — считаем выданным.
    return { delivered: false, alreadyDelivered: true, orderId: order.id }
  }

  // Выдаём позиции, которым ещё не выдан код.
  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('id, voucher_code, delivery_status')
    .eq('order_id', order.id)
  for (const it of items ?? []) {
    if (it.delivery_status === 'delivered' && it.voucher_code) continue
    await supabaseAdmin
      .from('order_items')
      .update({
        voucher_code: it.voucher_code || `NT-${randomBytes(4).toString('hex').toUpperCase()}`,
        delivery_status: 'delivered',
      })
      .eq('id', it.id)
  }

  // Промокод: +1 использование (один раз, т.к. переход new→paid произошёл здесь единожды).
  if (order.promo_code_id) {
    const { data: pc } = await supabaseAdmin
      .from('promo_codes')
      .select('used_count')
      .eq('id', order.promo_code_id)
      .maybeSingle()
    await supabaseAdmin
      .from('promo_codes')
      .update({ used_count: Number(pc?.used_count || 0) + 1 })
      .eq('id', order.promo_code_id)
  }

  return { delivered: true, alreadyDelivered: false, orderId: order.id }
}
