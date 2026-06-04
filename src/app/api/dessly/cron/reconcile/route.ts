import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getTransactionStatus } from '@/lib/dessly'
import { notifyOrderDelivered } from '@/lib/telegram/notify'
import { proportionalRefund } from '@/lib/order-math'
import { CRON_SECRET } from '@/lib/telegram/config'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dessly/cron/reconcile
 *
 * Фоновый дозабор статуса выдачи Dessly (Задача 7). При создании заказа гифт опрашивается
 * до ~30с; если за это время Dessly не довёл выдачу до терминального статуса, заказ остаётся
 * в работе (status=paid, позиция delivery_status=pending) — НЕ помечается failed раньше времени.
 * Этот cron допрашивает такие заказы и доводит их до delivered / cancelled(refund).
 *
 * Идентификация заказа у Dessly: order.supplier_trace_id = transactionId (order_id Dessly).
 *
 * БЕЗОПАСНОСТЬ: Authorization: Bearer <CRON_SECRET> или служебный заголовок Vercel Cron.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') || ''
  const isVercelCron = request.headers.get('x-vercel-cron') !== null
  const authorized = isVercelCron || (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Кандидаты: оплаченные заказы с trace-id (есть транзакция Dessly), не старше 48ч.
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString()
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, user_id, total_amount, final_amount, supplier_trace_id, created_at')
    .eq('status', 'paid')
    .not('supplier_trace_id', 'is', null)
    .gte('created_at', cutoff)
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let delivered = 0
  let failed = 0
  let stillPending = 0
  let skipped = 0

  for (const order of orders || []) {
    // Позиции этого заказа, которые ещё в обработке и относятся к Dessly.
    const { data: items } = await supabaseAdmin
      .from('order_items')
      .select('id, product_name, price, delivery_status, products!inner(supplier)')
      .eq('order_id', order.id)
      .eq('delivery_status', 'pending')
      .eq('products.supplier', 'dessly')

    if (!items || items.length === 0) {
      skipped++
      continue
    }

    let res
    try {
      res = await getTransactionStatus(order.supplier_trace_id as string)
    } catch (e) {
      // Сетевая/временная ошибка — не трогаем заказ, попробуем в следующий прогон.
      console.error('[dessly-reconcile] status check failed:', e instanceof Error ? e.message : e)
      stillPending++
      continue
    }

    if (res.status === 'pending') {
      stillPending++
      continue
    }

    if (res.status === 'sent') {
      // Выдача завершена: помечаем dessly-позиции delivered.
      const voucher = res.giftLink || `Гифт отправлен: транзакция ${order.supplier_trace_id}`
      for (const it of items) {
        await supabaseAdmin
          .from('order_items')
          .update({ delivery_status: 'delivered', voucher_code: voucher })
          .eq('id', it.id)
          .eq('delivery_status', 'pending') // защита от гонки с другим прогоном
      }
      // Если в заказе не осталось pending-позиций — заказ delivered.
      const { count: pendingLeft } = await supabaseAdmin
        .from('order_items')
        .select('id', { head: true, count: 'exact' })
        .eq('order_id', order.id)
        .eq('delivery_status', 'pending')
      const newStatus = (pendingLeft || 0) === 0 ? 'delivered' : 'paid'
      await supabaseAdmin.from('orders').update({ status: newStatus }).eq('id', order.id)
      if (order.user_id) {
        await notifyOrderDelivered(
          order.user_id,
          { order_number: order.order_number },
          items.map((it: any) => ({ product_name: it.product_name, voucher_code: voucher }))
        )
      }
      delivered++
      continue
    }

    // res.status === 'failed': выдача провалена → возврат за эти позиции + пометка failed.
    const failedLineTotal = items.reduce((s: number, it: any) => s + Number(it.price), 0)
    const refundAmount = proportionalRefund(
      Number(order.final_amount),
      failedLineTotal,
      Number(order.total_amount)
    )
    if (refundAmount > 0 && order.user_id) {
      const { data: cur } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', order.user_id)
        .single()
      if (cur) {
        await supabaseAdmin
          .from('users')
          .update({ balance: Number(cur.balance) + refundAmount })
          .eq('id', order.user_id)
        await supabaseAdmin.from('balance_transactions').insert({
          user_id: order.user_id,
          amount: refundAmount,
          type: 'refund',
          description: `Возврат за непоставленную позицию заказа ${order.order_number} (Dessly)`,
          order_id: order.id,
        })
      }
    }
    for (const it of items) {
      await supabaseAdmin
        .from('order_items')
        .update({ delivery_status: 'failed' })
        .eq('id', it.id)
        .eq('delivery_status', 'pending')
    }
    // Если не осталось ни delivered, ни pending — заказ cancelled.
    const { data: remaining } = await supabaseAdmin
      .from('order_items')
      .select('delivery_status')
      .eq('order_id', order.id)
    const hasDelivered = (remaining || []).some((r) => r.delivery_status === 'delivered')
    const hasPending = (remaining || []).some((r) => r.delivery_status === 'pending')
    const newStatus = !hasDelivered && !hasPending ? 'cancelled' : 'paid'
    await supabaseAdmin.from('orders').update({ status: newStatus }).eq('id', order.id)
    failed++
  }

  return NextResponse.json({
    ok: true,
    checked: orders?.length || 0,
    delivered,
    failed,
    stillPending,
    skipped,
  })
}
