// Выдача заказа после ПОДТВЕРЖДЁННОЙ оплаты (вебхук status: success && hold=0).
//
// ВАЖНО (live): выдача происходит ТОЛЬКО здесь, из обработчика вебхука — не синхронно при
// создании платежа. Идемпотентно: переход выполняется только из статуса 'new' → 'paid',
// повторные вебхуки/ретраи ничего не дублируют.
//
// ОБЛАСТЬ: instant-товары выдаются РЕАЛЬНО через общий deliverInstant (тот же модуль, что и
// /api/orders/create) — AppRoute (shop), Dessly (gift, по form_data позиции) или локальные ключи
// из product_keys. topup_auto/topup_manual/manual и позиции без product_id остаются 'pending'
// (закрывает менеджер). form_data сохраняется на чекауте (см. checkout/guest) — он нужен Dessly.
//
// УСТОЙЧИВОСТЬ: сбой/задержка поставщика в выдаче НЕ выбрасывает исключение — иначе заказ уже
// 'paid', вебхук вернул бы 5xx, а ретрай увидел бы статус 'paid' и пропустил выдачу. Вместо этого
// непоставленная позиция остаётся 'pending', заказ — 'paid' (в работе), вебхук отвечает 200.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { deliverInstant, DeliveryPendingError } from '@/lib/delivery'
import { safeGetOrCreateChat, safePostSystemMessage } from '@/lib/chat'
import type { Product } from '@/types'

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
    .select('id, status, promo_code_id, user_id')
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

  // Чат с покупателем (один на заказ, лениво создаётся ровно тут — момент первой оплаты).
  // created=true только при первом проходе (см. гейт status='new' выше), поэтому summary-
  // сообщение по pending-позициям ниже не задублируется при ретраях вебхука. Best-effort:
  // сбой чата не должен ронять выдачу (см. safeGetOrCreateChat).
  const chatResult = await safeGetOrCreateChat(order.id, order.user_id)
  const chat = chatResult?.chat ?? null
  const chatCreated = chatResult?.created ?? false
  const pendingNames: string[] = []
  // Одно сообщение на ВСЕ выданные позиции (а не по сообщению на позицию) — меньше сетевых
  // round-trip'ов на заказ и чище выглядит в чате при многотоварной корзине.
  const deliveredLines: string[] = []

  // Выдаём позиции, которым ещё не выдан код. Только instant выдаётся автоматически
  // (AppRoute/Dessly/локальные ключи через deliverInstant). topup_*/manual и позиции без
  // product_id остаются 'pending' (закрывает менеджер). Заказ доводим до 'delivered' только
  // если ВСЕ позиции выданы; иначе оставляем 'paid' (в работе).
  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('id, product_id, product_name, quantity, voucher_code, delivery_status, form_data')
    .eq('order_id', order.id)

  let allDelivered = true
  for (const it of items ?? []) {
    if (it.delivery_status === 'delivered' && it.voucher_code) continue

    // Без product_id (фолбэк-каталог) — выдаёт менеджер.
    if (!it.product_id) {
      allDelivered = false
      pendingNames.push(it.product_name)
      continue
    }

    const { data: product } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', it.product_id)
      .maybeSingle()

    // Только instant выдаётся автоматически; остальные типы — ручная обработка.
    if (!product || product.type !== 'instant') {
      allDelivered = false
      pendingNames.push(it.product_name)
      continue
    }

    try {
      // referenceId выдачи = invoice_id (= supplier_reference_id заказа). form_data сохранён на
      // чекауте (нужен Dessly: invite-ссылка/регион/издание); для AppRoute/ключей он не требуется.
      const formData = (it.form_data as Record<string, string> | null) ?? undefined
      const codes = await deliverInstant(product as unknown as Product, Number(it.quantity) || 1, invoiceId, formData)
      if (codes.length > 0) {
        await supabaseAdmin
          .from('order_items')
          .update({ voucher_code: codes.join('\n'), delivery_status: 'delivered' })
          .eq('id', it.id)
        deliveredLines.push(`📦 ${it.product_name}\n🔑 ${codes.join('\n')}`)
        continue
      }
      console.warn('[payments/fulfillment] выдача без кодов для', it.product_id)
    } catch (e) {
      if (e instanceof DeliveryPendingError) {
        console.warn('[payments/fulfillment] выдача в обработке (pending):', it.product_id, e.transactionId)
      } else {
        // НЕ пробрасываем: заказ уже paid, иначе ретрай вебхука пропустит выдачу. Позиция — pending.
        console.error('[payments/fulfillment] выдача упала для', it.product_id, e)
      }
    }
    allDelivered = false
    pendingNames.push(it.product_name)
  }

  if (chat && deliveredLines.length > 0) {
    await safePostSystemMessage(chat.id, deliveredLines.join('\n\n'))
  }
  if (chat && chatCreated && pendingNames.length > 0) {
    await safePostSystemMessage(
      chat.id,
      `⏳ Эти позиции в обработке у менеджера, ожидайте сообщения здесь:\n${pendingNames.map((n) => `• ${n}`).join('\n')}`
    )
  }

  // Если все позиции выданы — переводим заказ в delivered (ЛК покажет «Выполнен»).
  if (allDelivered && (items?.length ?? 0) > 0) {
    await supabaseAdmin.from('orders').update({ status: 'delivered' }).eq('id', order.id).eq('status', 'paid')
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
