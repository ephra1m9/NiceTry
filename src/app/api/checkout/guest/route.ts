import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  computeLinePrice,
  normalizeQuantity,
  statusDiscount,
  promoDiscount,
  settleAmounts,
  isPromoApplicable,
} from '@/lib/order-math'
import { normalizeEmail, isValidEmail } from '@/lib/auth/codes'
import { createPayment, paymentsMode } from '@/lib/payments'
import { upsertPaymentOnCreate } from '@/lib/payments/db'
import { signCheckoutToken } from '@/lib/payments/token'

/**
 * POST /api/checkout/guest — ГОСТЕВОЙ чекаут на ЗАГЛУШКЕ оплаты (PAYMENTS_MODE=mock).
 *
 * Авторизация НЕ требуется (в этом и смысл гостевого чекаута). Поток:
 *   1) Пересчёт сумм на сервере (клиенту не доверяем) из цен БД/каталога.
 *   2) Оплата через абстракцию createPayment (mock → всегда paid). Боевые интеграции
 *      поставщиков НЕ дёргаются: выдаём фиктивный DEMO-код.
 *   3) Создаём заказ со статусом 'paid' и почтой:
 *        - сессия активна  → заказ сразу в аккаунт (flow='session'), ник не спрашиваем;
 *        - есть аккаунт по этой почте (без сессии) → заказ привязываем к нему (flow='existing'),
 *          ник не спрашиваем, клиент предложит войти по коду;
 *        - новый гость → user_id=NULL, guest_email=почта (flow='nickname'), вернём checkout-токен
 *          для шага finalize (ник → аккаунт → авто-вход).
 *
 * ДЕМО: ничего реально не выдаётся и деньги не принимаются. Это видно по payment_method='mock'
 * и DEMO-кодам в позициях.
 */

interface IncomingItem {
  product_id: string
  quantity?: number
  custom_amount?: number
  price?: number
  form_data?: Record<string, string>
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()

    const body = await request.json().catch(() => null)
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'Корзина пуста' }, { status: 400 })
    }
    const items = body.items as IncomingItem[]

    // Почта: для гостя/без сессии — обязательна и валидируется. При активной сессии берём
    // почту аккаунта (поле с клиента игнорируем — источник истины это сессия).
    let email: string
    if (authUser?.email) {
      email = normalizeEmail(authUser.email)
    } else {
      email = normalizeEmail(String(body.email ?? ''))
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: 'Укажите корректный email для получения' }, { status: 400 })
      }
    }

    // 1) Пересчёт цен на сервере — ТОЛЬКО из Supabase (без AppRoute/Dessly).
    //    Гостевой чекаут не должен дёргать поставщиков — это тест логики авторизации.
    async function resolveProduct(id: string): Promise<Record<string, unknown> | null> {
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .maybeSingle()
      if (error) {
        console.error('[checkout/guest] resolveProduct DB error:', error)
      }
      return data as Record<string, unknown> | null
    }

    interface Line {
      product: Record<string, unknown>
      quantity: number
      linePrice: number
    }
    const lines: Line[] = []
    for (const item of items) {
      if (!item || typeof item.product_id !== 'string') {
        return NextResponse.json({ error: 'Некорректная позиция заказа' }, { status: 400 })
      }
      const product = await resolveProduct(item.product_id)
      if (!product) {
        return NextResponse.json({ error: `Товар недоступен: ${item.product_id}` }, { status: 400 })
      }
      const qty = normalizeQuantity(item.quantity)
      if (!qty.ok) {
        return NextResponse.json({ error: 'Некорректное количество' }, { status: 400 })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const priced = computeLinePrice(product as any, qty.quantity, Number(item.custom_amount))
      if (!priced.ok) {
        return NextResponse.json({ error: priced.error }, { status: 400 })
      }
      let linePrice = priced.linePrice

      // DEMO-режим: товары без цены в БД (например, dessly-гифты — цена зависит от издания и
      // резолвится через боевой API поставщика) НЕ дёргаем у поставщика. Для демо берём сумму,
      // присланную клиентом (custom_amount/price), как ориентир. На live это считает шлюз/поставщик.
      if (linePrice <= 0) {
        const clientHint = Number(item.custom_amount) || Number(item.price) || 0
        linePrice = clientHint > 0 ? clientHint * qty.quantity : 0
      }

      lines.push({ product, quantity: qty.quantity, linePrice })
    }

    const totalAmount = lines.reduce((s, l) => s + l.linePrice, 0)

    // 2) Скидки: статус — только у залогиненного пользователя; промокод — из БД.
    let discountAmount = 0
    let sessionProfileId: string | null = null
    if (authUser) {
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('id, status:user_statuses(discount_percent)')
        .eq('id', authUser.id)
        .maybeSingle()
      sessionProfileId = profile?.id ?? authUser.id
      const pct = Number((profile?.status as { discount_percent?: number } | null)?.discount_percent || 0)
      discountAmount += statusDiscount(totalAmount, pct)
    }

    let promoCodeId: string | null = null
    if (body.promo_code) {
      const { data: promo } = await supabaseAdmin
        .from('promo_codes')
        .select('*')
        .eq('code', String(body.promo_code).toUpperCase())
        .eq('is_active', true)
        .maybeSingle()
      if (isPromoApplicable(promo, new Date())) {
        promoCodeId = promo.id
        discountAmount += promoDiscount(totalAmount, promo.discount_type, Number(promo.discount_value))
      }
    }

    const settled = settleAmounts(totalAmount, discountAmount)
    discountAmount = settled.discount
    const finalAmount = settled.final

    // 3) Определяем владельца заказа и поток.
    //    flow='session'  — сессия активна → заказ сразу в аккаунт, ник не спрашиваем.
    //    flow='existing' — по почте уже есть аккаунт (без сессии) → привязываем, предложим вход по коду.
    //    flow='nickname' — новый гость → user_id=NULL + guest_email, дальше экран ника.
    let ownerUserId: string | null = null
    let flow: 'session' | 'existing' | 'nickname'

    if (authUser) {
      ownerUserId = sessionProfileId
      flow = 'session'
    } else {
      const { data: existing } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle()
      if (existing) {
        ownerUserId = existing.id
        flow = 'existing'
      } else {
        ownerUserId = null
        flow = 'nickname'
      }
    }

    // 4) Оплата. Сначала номер заказа/референс для идемпотентности.
    const referenceId = randomUUID()
    const orderNumber = `NT-${Date.now().toString(36).toUpperCase()}-${referenceId.slice(0, 4).toUpperCase()}`

    // ——— БОЕВОЙ режим (PAYMENTS_MODE=live): платёж асинхронный ———
    // Заказ создаём в статусе 'new' (pending), позиции — без кода (delivery_status='pending').
    // Деньги принимает pay4game; ВЫДАЧА произойдёт в вебхуке status (success && hold=0).
    if (paymentsMode() === 'live') {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert({
          order_number: orderNumber,
          user_id: ownerUserId,
          guest_email: email,
          total_amount: totalAmount,
          discount_amount: discountAmount,
          final_amount: finalAmount,
          status: 'new',
          payment_method: 'card',
          promo_code_id: promoCodeId,
          supplier_reference_id: referenceId,
        })
        .select()
        .single()
      if (orderError || !order) {
        console.error('[checkout/guest] (live) order insert failed:', orderError)
        return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
      }

      // Позиции — в обработке, код выдаст вебхук при успешной оплате.
      for (const line of lines) {
        const pid = String(line.product.id ?? '')
        const pname = String(line.product.name ?? '')
        await supabaseAdmin.from('order_items').insert({
          order_id: order.id,
          product_id: isUuid(pid) ? pid : null,
          product_name: pname,
          quantity: line.quantity,
          price: line.linePrice,
          delivery_status: 'pending',
        })
      }

      // Создаём платёж в pay4game. invoice_id = referenceId.
      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        undefined
      const payment = await createPayment({
        orderId: referenceId,
        orderNumber,
        amount: finalAmount,
        email,
        clientIp,
      })
      if (payment.status === 'failed' || !payment.uuid) {
        // Платёж не создан — заказ остаётся 'new' (не выдан), помечаем отменённым.
        await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
        return NextResponse.json({ error: payment.error || 'Не удалось создать платёж' }, { status: 402 })
      }

      await upsertPaymentOnCreate({
        invoice_id: referenceId,
        uuid: payment.uuid,
        method: process.env.PAY4GAME_DEFAULT_METHOD || 'sbp',
        amount: finalAmount,
        email,
      })

      // Токен нужен для finalize нового гостя после успешной оплаты (см. /pay).
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
        url: payment.url, // для card/sberpay — открыть в НОВОЙ вкладке (не iframe)
        pay_url: `/pay/${referenceId}`,
        ...(token ? { token } : {}),
      })
    }

    // ——— ДЕМО режим (PAYMENTS_MODE=mock): синхронная «оплата» ———
    const payment = await createPayment({
      orderId: referenceId,
      orderNumber,
      amount: finalAmount,
      email,
    })
    if (payment.status !== 'paid') {
      return NextResponse.json({ error: payment.error || 'Оплата не прошла' }, { status: 402 })
    }

    // 5) Создаём заказ (status='paid'). payment_method='mock' помечает ДЕМО-оплату.
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: ownerUserId,
        guest_email: email,
        total_amount: totalAmount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        status: 'paid',
        payment_method: 'mock',
        promo_code_id: promoCodeId,
        supplier_reference_id: referenceId,
        supplier_trace_id: payment.paymentId,
      })
      .select()
      .single()
    if (orderError || !order) {
      console.error('[checkout/guest] order insert failed:', orderError)
      // Логируем полную ошибку для отладки (колонка/ограничение/итд).
      if (orderError) {
        console.error('[checkout/guest] order insert details:', JSON.stringify(orderError, null, 2))
      }
      return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
    }

    // 6) Позиции заказа. ДЕМО: фиктивный код, delivery_status='delivered'. Поставщиков НЕ трогаем.
    for (const line of lines) {
      const pid = String(line.product.id ?? '')
      const pname = String(line.product.name ?? '')
      await supabaseAdmin.from('order_items').insert({
        order_id: order.id,
        product_id: isUuid(pid) ? pid : null,
        product_name: pname,
        quantity: line.quantity,
        price: line.linePrice,
        voucher_code: `DEMO-${randomBytes(4).toString('hex').toUpperCase()}`,
        delivery_status: 'delivered',
      })
    }

    // 7) Промокод: +1 использование.
    if (promoCodeId) {
      const { data: pc } = await supabaseAdmin
        .from('promo_codes')
        .select('used_count')
        .eq('id', promoCodeId)
        .single()
      await supabaseAdmin
        .from('promo_codes')
        .update({ used_count: Number(pc?.used_count || 0) + 1 })
        .eq('id', promoCodeId)
    }

    const orderPayload = {
      id: order.id,
      order_number: orderNumber,
      status: 'paid' as const,
      total_amount: totalAmount,
      discount_amount: discountAmount,
      final_amount: finalAmount,
    }

    // Только новому гостю выдаём checkout-токен (нужен на шаге ника/привязки).
    const token = flow === 'nickname' ? signCheckoutToken(order.id, email) : undefined

    return NextResponse.json({
      success: true,
      demo: payment.demo,
      flow,
      email,
      order: orderPayload,
      ...(token ? { token } : {}),
    })
  } catch (error) {
    console.error('[checkout/guest] unexpected error:', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Ошибка оформления заказа: ${detail}` }, { status: 500 })
  }
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
