import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeEmail, isValidEmail } from '@/lib/auth/codes'
import { createPayment, paymentsMode } from '@/lib/payments'
import { upsertPaymentOnCreate } from '@/lib/payments/db'
import { signCheckoutToken } from '@/lib/payments/token'
import { deliverGameTopup } from '@/lib/delivery'
import { safeGetOrCreateChat, safePostSystemMessage } from '@/lib/chat'
import { getGameTopupGame, getGameDenomination } from '@/lib/game-topup-settings'

/**
 * POST /api/auto-games/order — создание заказа на игровое пополнение через AppRoute DTU.
 *
 * Аналог /api/dessly/esim/order: отдельный эндпоинт (не /api/orders/create), т.к. игры
 * не лежат в основном каталоге продуктов (price динамическая, деноминации из AppRoute).
 *
 * payment_method:
 *   balance — CAS-списание → deliverGameTopup() → результат в чат заказа.
 *   card    — live: pay4game-платёж → pay_url; mock: синхронная демо-оплата + deliverGameTopup().
 */
export const maxDuration = 60

interface DeliveryOutcome {
  status: 'delivered' | 'failed'
  voucherCode: string | null
}

async function tryDeliver(
  denominationId: string,
  fields: Array<{ key: string; value: string }>,
  referenceId: string
): Promise<DeliveryOutcome> {
  try {
    const codes = await deliverGameTopup(denominationId, fields, referenceId)
    return { status: 'delivered', voucherCode: codes.join('\n') }
  } catch (e) {
    console.error('[auto-games/order] delivery failed:', e instanceof Error ? e.message : e)
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

    const gameSlug = String(body.game_slug || '').trim()
    const denominationId = String(body.denomination_id || '').trim()
    const accountData = body.account_data
    const paymentMethod = body.payment_method

    if (!gameSlug || !denominationId) {
      return NextResponse.json({ error: 'Не указана игра или пакет пополнения' }, { status: 400 })
    }
    if (!accountData || typeof accountData !== 'object') {
      return NextResponse.json({ error: 'Не указаны данные аккаунта' }, { status: 400 })
    }
    if (paymentMethod !== 'balance' && paymentMethod !== 'card') {
      return NextResponse.json({ error: 'Некорректный способ оплаты' }, { status: 400 })
    }

    // Валидация игры и деноминации на сервере (не доверяем цене с клиента).
    const game = await getGameTopupGame(gameSlug)
    if (!game) {
      return NextResponse.json({ error: 'Игра не найдена или недоступна' }, { status: 404 })
    }
    const denomination = await getGameDenomination(denominationId)
    if (!denomination || denomination.game_id !== game.id) {
      return NextResponse.json({ error: 'Пакет пополнения не найден или недоступен' }, { status: 404 })
    }

    // Серверная цена — не доверяем клиенту.
    const amount = denomination.price_rub
    const itemName = `${game.name} · ${denomination.name}`
    const dtuFields = Object.entries(accountData as Record<string, string>).map(([key, value]) => ({ key, value }))
    const formData = {
      type: 'game_topup',
      game_slug: gameSlug,
      denomination_id: denominationId,
      account_data: accountData as Record<string, string>,
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
        console.error('[auto-games/order] insert failed:', orderError)
        return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
      }

      // CAS-списание (защита от гонки параллельных заказов).
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

      const outcome = await tryDeliver(denomination.approute_denomination_id, dtuFields, referenceId)

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
        // Возврат на баланс при провале выдачи.
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
            description: `Возврат за заказ ${orderNumber} (пополнение не выполнено)`,
            order_id: order.id,
          })
        }
        await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
      } else {
        await supabaseAdmin.from('orders').update({ status: 'delivered' }).eq('id', order.id)
        const chatResult = await safeGetOrCreateChat(order.id, authUser.id)
        if (chatResult) {
          await safePostSystemMessage(
            chatResult.chat.id,
            `📦 ${itemName}\n✅ ${outcome.voucherCode || 'Пополнение зачислено'}`
          )
        }
      }

      return NextResponse.json({
        success: true,
        order: {
          id: order.id,
          order_number: orderNumber,
          status: outcome.status === 'failed' ? 'cancelled' : 'delivered',
          final_amount: amount,
        },
        delivery_status: outcome.status,
        ...(outcome.status === 'delivered' ? { result: outcome.voucherCode } : {}),
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

    // ——— БОЕВОЙ режим: платёж асинхронный, выдача — в вебхуке ———
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

    // ——— ДЕМО режим: синхронная оплата + выдача ———
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
      return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
    }

    const outcome = await tryDeliver(denomination.approute_denomination_id, dtuFields, referenceId)
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
    if (outcome.status === 'delivered') {
      await supabaseAdmin.from('orders').update({ status: 'delivered' }).eq('id', order.id)
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
        status: outcome.status === 'delivered' ? 'delivered' : 'cancelled',
      },
      delivery_status: outcome.status,
      ...(outcome.status === 'delivered' ? { result: outcome.voucherCode } : {}),
      ...(token ? { token } : {}),
    })
  } catch (error) {
    console.error('[auto-games/order] unexpected error:', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Ошибка оформления заказа: ${detail}` }, { status: 500 })
  }
}
