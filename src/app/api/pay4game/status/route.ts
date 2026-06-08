import { NextRequest, NextResponse } from 'next/server'
import { getPaymentByInvoice, updatePayment } from '@/lib/payments/db'
import { paymentStatus, getPay4gameConfig } from '@/lib/payments/pay4game'
import { markOrderPaidAndDeliver } from '@/lib/payments/fulfillment'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { signCheckoutToken } from '@/lib/payments/token'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pay4game/status?invoice_id=... — статус платежа для страницы оплаты (поллинг).
 *
 * Возвращает текущий статус из нашей БД (его обновляет вебхук). Если платёж ещё pending —
 * выполняет FALLBACK-поллинг payment/status у pay4game (на случай, если вебхук задержался) и,
 * при success && hold=0, доводит заказ до выдачи прямо здесь (идемпотентно).
 *
 * Токен finalize отдаём ТОЛЬКО когда платёж успешен и заказ ещё гостевой (user_id=NULL) —
 * для шага ника. invoice_id — неугадываемый UUID, поэтому это безопасная capability-ссылка.
 */
export async function GET(request: NextRequest) {
  const invoiceId = request.nextUrl.searchParams.get('invoice_id')?.trim()
  if (!invoiceId) {
    return NextResponse.json({ error: 'invoice_id обязателен' }, { status: 400 })
  }

  let payment = await getPaymentByInvoice(invoiceId)
  if (!payment) {
    return NextResponse.json({ error: 'Платёж не найден' }, { status: 404 })
  }

  // Fallback-поллинг: если ещё pending — спросим pay4game напрямую.
  if (payment.status === 'pending') {
    try {
      const cfg = getPay4gameConfig()
      const remote = await paymentStatus(invoiceId, cfg)
      const hold = Number(remote.hold ?? 0)
      if (remote.status && remote.status !== 'pending') {
        await updatePayment(invoiceId, { status: remote.status, hold, uuid: remote.uuid })
        if (remote.status === 'success' && hold === 0) {
          await markOrderPaidAndDeliver(invoiceId, remote.uuid)
        }
        payment = await getPaymentByInvoice(invoiceId)
      }
    } catch (e) {
      // Поллинг — необязательный резерв; не валим страницу, ждём вебхук.
      console.warn('[pay4game/status] fallback poll failed:', e)
    }
  }

  if (!payment) {
    return NextResponse.json({ error: 'Платёж не найден' }, { status: 404 })
  }

  // Заказ (по supplier_reference_id = invoice_id).
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, status, user_id, guest_email')
    .eq('supplier_reference_id', invoiceId)
    .maybeSingle()

  const paid = payment.status === 'success' && Number(payment.hold) === 0 && order?.status !== 'new'

  // Токен ника — только когда оплачено и заказ ещё гостевой (новый гость).
  let token: string | undefined
  if (paid && order && !order.user_id && order.guest_email) {
    token = signCheckoutToken(order.id, order.guest_email)
  }

  return NextResponse.json({
    invoice_id: invoiceId,
    status: payment.status,
    hold: Number(payment.hold),
    qr_content: payment.qr_content,
    qr_img: payment.qr_img,
    // Ссылка на хостовую страницу оплаты pay4game — фолбэк-кнопка, когда QR (вебхук inform) ещё не пришёл.
    url: payment.url ?? null,
    paid,
    order: order ? { id: order.id, status: order.status, has_owner: !!order.user_id } : null,
    email: order?.guest_email ?? payment.email ?? undefined,
    ...(token ? { token } : {}),
  })
}
