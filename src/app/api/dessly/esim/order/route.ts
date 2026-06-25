import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeEmail, isValidEmail } from '@/lib/auth/codes'
import { createPayment, paymentsMode } from '@/lib/payments'
import { upsertPaymentOnCreate } from '@/lib/payments/db'
import { signCheckoutToken } from '@/lib/payments/token'
import { getEsimVariant } from '@/lib/dessly'
import { deliverEsim, DeliveryPendingError } from '@/lib/delivery'
import { safeGetOrCreateChat, safePostSystemMessage } from '@/lib/chat'
import { priceRub } from '@/lib/catalog'
import { loadEsimSettings } from '@/lib/esim-settings'

/**
 * POST /api/dessly/esim/order — покупка eSIM (страница /esim).
 *
 * eSIM не лежит в общем каталоге (variant/product приходят от Dessly на лету, пагинируются —
 * см. lib/dessly.ts listEsimVariants/getEsimVariant), поэтому покупка идёт через отдельный
 * эндпоинт (как /api/steam/topup), а не через /api/orders/create. В отличие от topup, здесь
 * выдачу делает НЕ платёжный шлюз, а Dessly (createEsimOrder/getEsimOrderStatus) — см. deliverEsim.
 *
 * payment_method:
 *   balance — требует сессию. Списание с CAS-проверкой → сразу deliverEsim() → voucher_code
 *             с данными активации в чат заказа (как /api/orders/create).
 *   card    — email из сессии или body.email (как /api/steam/topup). live: создаём pay4game-
 *             платёж и возвращаем pay_url, реальная выдача — в вебхуке (fulfillment.ts, по
 *             form_data.type==='esim'). mock: синхронная демо-оплата + сразу deliverEsim()
 *             (режим Dessly mock/live управляется отдельно DESSLY_API_KEY/SECRET).
 */
export const maxDuration = 60

interface DeliveryOutcome {
  status: 'pending' | 'delivered' | 'failed'
  voucherCode: string | null
  traceId?: string
}

async function tryDeliver(variantId: string, productId: string, referenceId: string): Promise<DeliveryOutcome> {
  try {
    const codes = await deliverEsim(variantId, productId, referenceId)
    return { status: 'delivered', voucherCode: codes.join('\n') }
  } catch (e) {
    if (e instanceof DeliveryPendingError) {
      return { status: 'pending', voucherCode: null, traceId: e.transactionId }
    }
    console.error('[dessly/esim/order] delivery failed:', e instanceof Error ? e.message : e)
    return { status: 'failed', voucherCode: null }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
    }
    const variantId = String(body.variant_id || '').trim()
    const productId = String(body.product_id || '').trim()
    const paymentMethod = body.payment_method
    if (!variantId || !productId) {
      return NextResponse.json({ error: 'Не указан пакет или тариф eSIM' }, { status: 400 })
    }
    if (paymentMethod !== 'balance' && paymentMethod !== 'card') {
      return NextResponse.json({ error: 'Некорректный способ оплаты' }, { status: 400 })
    }

    // Цена — только с сервера: резолвим variant/plan через живой/мок каталог Dessly, клиенту не доверяем.
    const detail = await getEsimVariant(variantId)
    const plan = detail?.plans.find((p) => p.id === productId)
    if (!detail || !plan) {
      return NextResponse.json({ error: 'Тариф недоступен' }, { status: 400 })
    }
    if (plan.stock <= 0) {
      return NextResponse.json({ error: 'Тариф временно недоступен' }, { status: 400 })
    }
    const { usd_to_rub_rate: rate, markup_percent: markup } = await loadEsimSettings()
    const amount = priceRub(plan.price, rate, markup)
    const itemName = `eSIM ${detail.variant.name} · ${plan.name}`
    const formData = {
      type: 'esim',
      variant_id: variantId,
      product_id: productId,
      country: detail.variant.country || detail.variant.continent || '',
      plan_label: plan.name,
    }

    // ——— Оплата с баланса ———
    if (paymentMethod === 'balance') {
      if (!authUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('id, balance')
        .eq('id', authUser.id)
        .single()
      if (!profile) {
        return NextResponse.json({ error: 'Профиль пользователя не найден' }, { status: 404 })
      }
      if (Number(profile.balance) < amount) {
        return NextResponse.json({ error: 'Недостаточно средств на балансе' }, { status: 400 })
      }

      const referenceId = randomUUID()
      const orderNumber = `NT-${Date.now().toString(36).toUpperCase()}-${referenceId.slice(0, 4).toUpperCase()}`
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert({
          order_number: orderNumber,
          user_id: authUser.id,
          total_amount: amount,
          discount_amount: 0,
          final_amount: amount,
          status: 'paid',
          payment_method: 'balance',
          supplier_reference_id: referenceId,
        })
        .select()
        .single()
      if (orderError || !order) {
        console.error('[dessly/esim/order] insert failed:', orderError)
        return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
      }

      // CAS-списание (как /api/orders/create): защищает от гонки параллельных заказов.
      const { data: debited, error: balErr } = await supabaseAdmin
        .from('users')
        .update({ balance: Number(profile.balance) - amount })
        .eq('id', authUser.id)
        .eq('balance', profile.balance)
        .gte('balance', amount)
        .select('id')
        .maybeSingle()
      if (balErr || !debited) {
        await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
        return NextResponse.json({ error: 'Не удалось списать средства, повторите попытку' }, { status: 409 })
      }
      await supabaseAdmin.from('balance_transactions').insert({
        user_id: authUser.id,
        amount: -amount,
        type: 'purchase',
        description: `Оплата заказа ${orderNumber}`,
        order_id: order.id,
      })

      const outcome = await tryDeliver(variantId, productId, referenceId)
      await supabaseAdmin.from('order_items').insert({
        order_id: order.id,
        product_id: null,
        product_name: itemName,
        quantity: 1,
        price: amount,
        voucher_code: outcome.voucherCode,
        delivery_status: outcome.status,
        form_data: formData,
      })

      if (outcome.status === 'failed') {
        // Провал выдачи — возврат на баланс, заказ отменён.
        const { data: cur } = await supabaseAdmin.from('users').select('balance').eq('id', authUser.id).single()
        if (cur) {
          await supabaseAdmin
            .from('users')
            .update({ balance: Number(cur.balance) + amount })
            .eq('id', authUser.id)
          await supabaseAdmin.from('balance_transactions').insert({
            user_id: authUser.id,
            amount,
            type: 'refund',
            description: `Возврат за заказ ${orderNumber} (eSIM не выдан)`,
            order_id: order.id,
          })
        }
        await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
      } else {
        const newStatus = outcome.status === 'delivered' ? 'delivered' : 'paid'
        await supabaseAdmin
          .from('orders')
          .update({ status: newStatus, supplier_trace_id: outcome.traceId || null })
          .eq('id', order.id)

        const chatResult = await safeGetOrCreateChat(order.id, authUser.id)
        if (chatResult) {
          const { chat } = chatResult
          if (outcome.status === 'delivered' && outcome.voucherCode) {
            await safePostSystemMessage(chat.id, `📦 ${itemName}\n🔑 ${outcome.voucherCode}`)
          } else {
            await safePostSystemMessage(chat.id, `⏳ «${itemName}» в обработке у поставщика, ожидайте сообщения здесь.`)
          }
        }
      }

      return NextResponse.json({
        success: true,
        order: {
          id: order.id,
          order_number: orderNumber,
          status: outcome.status === 'failed' ? 'cancelled' : outcome.status === 'delivered' ? 'delivered' : 'paid',
          final_amount: amount,
        },
        delivery_status: outcome.status,
        ...(outcome.status === 'delivered' ? { activation: outcome.voucherCode } : {}),
      })
    }

    // ——— Оплата картой ———
    let email: string
    if (authUser?.email) {
      email = normalizeEmail(authUser.email)
    } else {
      email = normalizeEmail(String(body.email ?? ''))
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: 'Укажите корректный email для чека' }, { status: 400 })
      }
    }

    let ownerUserId: string | null = null
    let flow: 'session' | 'existing' | 'nickname'
    if (authUser) {
      ownerUserId = authUser.id
      flow = 'session'
    } else {
      const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle()
      if (existing) {
        ownerUserId = existing.id
        flow = 'existing'
      } else {
        ownerUserId = null
        flow = 'nickname'
      }
    }

    const referenceId = randomUUID()
    const orderNumber = `NT-${Date.now().toString(36).toUpperCase()}-${referenceId.slice(0, 4).toUpperCase()}`

    // ——— БОЕВОЙ режим (live): платёж асинхронный, выдача — в вебхуке ———
    if (paymentsMode() === 'live') {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert({
          order_number: orderNumber,
          user_id: ownerUserId,
          guest_email: email,
          total_amount: amount,
          discount_amount: 0,
          final_amount: amount,
          status: 'new',
          payment_method: 'card',
          supplier_reference_id: referenceId,
        })
        .select()
        .single()
      if (orderError || !order) {
        console.error('[dessly/esim/order] (live) order insert failed:', orderError)
        return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
      }
      await supabaseAdmin.from('order_items').insert({
        order_id: order.id,
        product_id: null,
        product_name: itemName,
        quantity: 1,
        price: amount,
        delivery_status: 'pending',
        form_data: formData,
      })

      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        undefined
      const payment = await createPayment({
        orderId: referenceId,
        orderNumber,
        amount,
        email,
        clientIp,
        risk: 5,
        description: itemName,
      })
      if (payment.status === 'failed' || !payment.uuid) {
        await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
        return NextResponse.json({ error: payment.error || 'Не удалось создать платёж' }, { status: 402 })
      }
      await upsertPaymentOnCreate({
        invoice_id: referenceId,
        uuid: payment.uuid,
        method: process.env.PAY4GAME_DEFAULT_METHOD || 'sbp',
        amount,
        email,
        url: payment.url ?? null,
      })

      const token = flow === 'nickname' ? signCheckoutToken(order.id, email) : undefined
      return NextResponse.json({
        success: true,
        mode: 'live',
        demo: false,
        flow,
        email,
        order: { id: order.id, order_number: orderNumber, status: 'new' as const },
        invoice_id: referenceId,
        uuid: payment.uuid,
        url: payment.url,
        pay_url: `/pay/${referenceId}`,
        ...(token ? { token } : {}),
      })
    }

    // ——— ДЕМО режим (mock): синхронная оплата + сразу deliverEsim (мок/боевой режим Dessly
    // переключается отдельно DESSLY_API_KEY/SECRET, не зависит от PAYMENTS_MODE) ———
    const payment = await createPayment({ orderId: referenceId, orderNumber, amount, email })
    if (payment.status !== 'paid') {
      return NextResponse.json({ error: payment.error || 'Оплата не прошла' }, { status: 402 })
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: ownerUserId,
        guest_email: email,
        total_amount: amount,
        discount_amount: 0,
        final_amount: amount,
        status: 'paid',
        payment_method: 'mock',
        supplier_reference_id: referenceId,
        supplier_trace_id: payment.paymentId,
      })
      .select()
      .single()
    if (orderError || !order) {
      console.error('[dessly/esim/order] (mock) order insert failed:', orderError)
      return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
    }

    const outcome = await tryDeliver(variantId, productId, referenceId)
    await supabaseAdmin.from('order_items').insert({
      order_id: order.id,
      product_id: null,
      product_name: itemName,
      quantity: 1,
      price: amount,
      voucher_code: outcome.voucherCode,
      delivery_status: outcome.status,
      form_data: formData,
    })
    if (outcome.status !== 'failed') {
      const newStatus = outcome.status === 'delivered' ? 'delivered' : 'paid'
      await supabaseAdmin
        .from('orders')
        .update({ status: newStatus, supplier_trace_id: outcome.traceId || payment.paymentId || null })
        .eq('id', order.id)
    }

    const token = flow === 'nickname' ? signCheckoutToken(order.id, email) : undefined
    return NextResponse.json({
      success: true,
      mode: 'mock',
      demo: true,
      flow,
      email,
      order: {
        id: order.id,
        order_number: orderNumber,
        status: outcome.status === 'delivered' ? 'delivered' : outcome.status === 'failed' ? 'cancelled' : 'paid',
      },
      delivery_status: outcome.status,
      ...(outcome.status === 'delivered' ? { activation: outcome.voucherCode } : {}),
      ...(token ? { token } : {}),
    })
  } catch (error) {
    console.error('[dessly/esim/order] unexpected error:', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Ошибка оформления заказа: ${detail}` }, { status: 500 })
  }
}
