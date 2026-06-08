import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeEmail, isValidEmail } from '@/lib/auth/codes'
import { createPayment, paymentsMode } from '@/lib/payments'
import { upsertPaymentOnCreate } from '@/lib/payments/db'
import { signCheckoutToken } from '@/lib/payments/token'
import { validateTopup, getSteamTopupConfig } from '@/lib/steam-topup'

/**
 * POST /api/steam/topup — пополнение Steam-кошелька через pay4game (карточка «Пополни Steam»).
 *
 * Боевой поток (PAYMENTS_MODE=live): создаём платёж pay4game со steam_account+steam_amount
 * (risk=1 — низкорисковое авто-пополнение). Деньги принимает pay4game, кошелёк зачисляет он же;
 * статус приходит в вебхуках status / status_steam. Заказ создаём для истории/трекинга — одна
 * синтетическая позиция без product_id (выдавать нечего, кошелёк пополняет pay4game).
 *
 * ДЕМО (PAYMENTS_MODE=mock): синхронная имитация — деньги не приняты, Steam не пополнен.
 *
 * Денежная модель: amount(введён пользователем) = steam_amount (₽, зачисление в кошелёк);
 * к оплате charge = amount + комиссия 3%. См. src/lib/steam-topup.ts.
 */
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

    // 1) Email: сессия — источник истины; гость — обязателен и валидируется.
    let email: string
    if (authUser?.email) {
      email = normalizeEmail(authUser.email)
    } else {
      email = normalizeEmail(String(body.email ?? ''))
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: 'Укажите корректный email для чека' }, { status: 400 })
      }
    }

    // 2) Валидация пополнения (логин/регион/сумма) + расчёт комиссии и итога к оплате.
    const cfg = getSteamTopupConfig()
    const v = validateTopup({ account: body.account, region: body.region, amount: body.amount }, cfg)
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 })
    }
    const { account, region, steamAmount, commission, charge } = v.value

    // 3) Владелец заказа и поток (как в гостевом чекауте).
    let ownerUserId: string | null = null
    let flow: 'session' | 'existing' | 'nickname'
    if (authUser) {
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', authUser.id)
        .maybeSingle()
      ownerUserId = profile?.id ?? authUser.id
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
    const itemName = `Пополнение Steam · ${account} · ${region.label}`
    const formData = {
      type: 'steam_topup',
      steam_account: account,
      steam_amount: String(steamAmount),
      region: region.code,
    }

    // ——— БОЕВОЙ режим (live) ———
    if (paymentsMode() === 'live') {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert({
          order_number: orderNumber,
          user_id: ownerUserId,
          guest_email: email,
          total_amount: charge,
          discount_amount: 0,
          final_amount: charge,
          status: 'new',
          payment_method: 'card',
          supplier_reference_id: referenceId,
        })
        .select()
        .single()
      if (orderError || !order) {
        console.error('[steam/topup] (live) order insert failed:', orderError)
        return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
      }

      // Позиция: выдавать нечего (кошелёк пополняет pay4game) — остаётся pending. form_data хранит
      // параметры пополнения. Защита от рассинхрона миграции form_data: повтор без неё.
      const baseItem = {
        order_id: order.id,
        product_id: null,
        product_name: itemName,
        quantity: 1,
        price: charge,
        delivery_status: 'pending' as const,
      }
      const { error: itemErr } = await supabaseAdmin.from('order_items').insert({ ...baseItem, form_data: formData })
      if (itemErr) {
        console.warn('[steam/topup] (live) order_item с form_data упал, повтор без него:', itemErr.message)
        await supabaseAdmin.from('order_items').insert(baseItem)
      }

      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        undefined

      const payment = await createPayment({
        orderId: referenceId,
        orderNumber,
        amount: charge,
        email,
        clientIp,
        steamAccount: account,
        steamAmount,
        risk: 1, // авто-пополнение Steam — низкий риск
        description: `Пополнение Steam ${account} (${region.code})`,
      })
      if (payment.status === 'failed' || !payment.uuid) {
        await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
        return NextResponse.json({ error: payment.error || 'Не удалось создать платёж' }, { status: 402 })
      }

      await upsertPaymentOnCreate({
        invoice_id: referenceId,
        uuid: payment.uuid,
        method: process.env.PAY4GAME_DEFAULT_METHOD || 'sbp',
        amount: charge,
        email,
        steam_account: account,
        steam_amount: steamAmount,
      })

      const token = flow === 'nickname' ? signCheckoutToken(order.id, email) : undefined
      return NextResponse.json({
        success: true,
        mode: 'live',
        demo: false,
        flow,
        email,
        steam: { account, region: region.code, steam_amount: steamAmount, commission, charge },
        order: { id: order.id, order_number: orderNumber, status: 'new' as const },
        invoice_id: referenceId,
        uuid: payment.uuid,
        url: payment.url,
        pay_url: `/pay/${referenceId}`,
        ...(token ? { token } : {}),
      })
    }

    // ——— ДЕМО режим (mock): синхронная имитация ———
    const payment = await createPayment({
      orderId: referenceId,
      orderNumber,
      amount: charge,
      email,
      steamAccount: account,
      steamAmount,
    })
    if (payment.status !== 'paid') {
      return NextResponse.json({ error: payment.error || 'Оплата не прошла' }, { status: 402 })
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: ownerUserId,
        guest_email: email,
        total_amount: charge,
        discount_amount: 0,
        final_amount: charge,
        status: 'paid',
        payment_method: 'mock',
        supplier_reference_id: referenceId,
        supplier_trace_id: payment.paymentId,
      })
      .select()
      .single()
    if (orderError || !order) {
      console.error('[steam/topup] (mock) order insert failed:', orderError)
      return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
    }

    await supabaseAdmin.from('order_items').insert({
      order_id: order.id,
      product_id: null,
      product_name: itemName,
      quantity: 1,
      price: charge,
      voucher_code: `DEMO-STEAM-${randomBytes(3).toString('hex').toUpperCase()}`,
      delivery_status: 'delivered',
    })

    const token = flow === 'nickname' ? signCheckoutToken(order.id, email) : undefined
    return NextResponse.json({
      success: true,
      mode: 'mock',
      demo: true,
      flow,
      email,
      steam: { account, region: region.code, steam_amount: steamAmount, commission, charge },
      order: { id: order.id, order_number: orderNumber, status: 'paid' as const },
      ...(token ? { token } : {}),
    })
  } catch (error) {
    console.error('[steam/topup] unexpected error:', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Ошибка пополнения: ${detail}` }, { status: 500 })
  }
}
