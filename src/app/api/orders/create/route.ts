import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildCatalogProducts } from '@/lib/catalog'
import {
  createShopOrder,
  waitForOrder,
  unhideVouchers,
  AppRouteError,
} from '@/lib/approute'
import { sendGift, DesslyError } from '@/lib/dessly'
import { notifyOrderDelivered } from '@/lib/telegram/notify'
import { REFERRAL_PERCENTS } from '@/lib/constants'
import {
  computeLinePrice,
  normalizeQuantity,
  statusDiscount,
  promoDiscount,
  settleAmounts,
  isPromoApplicable,
  computeReferralBonus,
} from '@/lib/order-math'
import type { Product } from '@/types'

/**
 * POST /api/orders/create
 *
 * БЕЗОПАСНОСТЬ: суммы НЕ доверяются клиенту — пересчитываются на сервере из цен товаров
 * в БД (или каталога-фолбэка). Все привилегированные операции (списание баланса, выдача
 * ключей, реферальные начисления) идут через service-role клиент после проверки сессии.
 *
 * ПАУЗА (Контур A): реальный приём денег (карта/крипта) не реализуется до подключения
 * платёжной системы — такие методы оплаты возвращают 501. Оплата с внутреннего баланса
 * (Контур B — исполнение через поставщика) работает полностью.
 */
interface IncomingItem {
  product_id: string
  quantity?: number
  custom_amount?: number
  form_data?: Record<string, string>
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'Корзина пуста' }, { status: 400 })
    }
    const items = body.items as IncomingItem[]
    const paymentMethod = body.payment_method

    // Пауза: только оплата с баланса до подключения эквайринга.
    if (paymentMethod !== 'balance') {
      return NextResponse.json(
        { error: 'Оплата картой/криптой будет доступна после подключения платёжной системы' },
        { status: 501 }
      )
    }

    // Профиль пользователя (service-role, чтобы не зависеть от RLS).
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*, status:user_statuses(*)')
      .eq('id', authUser.id)
      .single()
    if (profileError || !profile) {
      return NextResponse.json({ error: 'Профиль пользователя не найден' }, { status: 404 })
    }

    // Источник цен: БД, с фолбэком на сгенерированный каталог (мок-режим без сидинга).
    let catalogFallback: Product[] | null = null
    async function resolveProduct(id: string): Promise<Product | null> {
      const { data } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .maybeSingle()
      if (data) return data as Product
      if (!catalogFallback) catalogFallback = await buildCatalogProducts()
      return catalogFallback.find((p) => p.id === id && p.is_active) || null
    }

    // 1) Пересчёт сумм на сервере + валидация.
    interface Line {
      product: Product
      quantity: number
      linePrice: number
      formData?: Record<string, string>
    }
    const lines: Line[] = []
    for (const item of items) {
      if (!item || typeof item.product_id !== 'string') {
        return NextResponse.json({ error: 'Некорректная позиция заказа' }, { status: 400 })
      }
      const product = await resolveProduct(item.product_id)
      if (!product) {
        return NextResponse.json(
          { error: `Товар недоступен: ${item.product_id}` },
          { status: 400 }
        )
      }

      const qty = normalizeQuantity(item.quantity)
      if (!qty.ok) {
        return NextResponse.json({ error: 'Некорректное количество' }, { status: 400 })
      }

      const priced = computeLinePrice(product, qty.quantity, Number(item.custom_amount))
      if (!priced.ok) {
        return NextResponse.json({ error: priced.error }, { status: 400 })
      }
      lines.push({ product, quantity: qty.quantity, linePrice: priced.linePrice, formData: item.form_data })
    }

    const totalAmount = lines.reduce((s, l) => s + l.linePrice, 0)

    // 2) Скидка статуса + промокод (валидация на сервере).
    const statusDiscountPercent = Number(profile.status?.discount_percent || 0)
    let discountAmount = statusDiscount(totalAmount, statusDiscountPercent)

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
        discountAmount += promoDiscount(
          totalAmount,
          promo.discount_type,
          Number(promo.discount_value)
        )
      }
    }
    const settled = settleAmounts(totalAmount, discountAmount)
    discountAmount = settled.discount
    const finalAmount = settled.final

    // 3) Проверка баланса (оплата с баланса).
    if (Number(profile.balance) < finalAmount) {
      return NextResponse.json({ error: 'Недостаточно средств на балансе' }, { status: 400 })
    }

    // 4) Создание заказа.
    const referenceId = randomUUID() // идемпотентность для AppRoute
    // order_number включает фрагмент uuid, иначе при двойном клике в одну миллисекунду
    // два заказа получат одинаковый Date.now()-номер и второй упадёт на UNIQUE-ограничении.
    const orderNumber = `NT-${Date.now().toString(36).toUpperCase()}-${referenceId.slice(0, 4).toUpperCase()}`
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: authUser.id,
        total_amount: totalAmount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        status: 'paid',
        payment_method: 'balance',
        promo_code_id: promoCodeId,
        supplier_reference_id: referenceId,
      })
      .select()
      .single()
    if (orderError || !order) {
      console.error('[orders] insert failed:', orderError)
      return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
    }

    // 5) Списание баланса + транзакция (до выдачи, чтобы не выдать без оплаты).
    // CAS (compare-and-swap): обновляем баланс ТОЛЬКО если он не изменился с момента чтения
    // (.eq('balance', profile.balance)). Это исключает «потерянное обновление» при гонке двух
    // параллельных заказов: иначе оба прочли бы 100, оба записали бы абсолютное 50 — и пользователь
    // получил бы два товара, заплатив за один. Дополнительно .gte защищает от ухода в минус.
    const { data: debited, error: balErr } = await supabaseAdmin
      .from('users')
      .update({ balance: Number(profile.balance) - finalAmount })
      .eq('id', authUser.id)
      .eq('balance', profile.balance)
      .gte('balance', finalAmount)
      .select('id')
      .maybeSingle()
    if (balErr || !debited) {
      // Баланс изменился между чтением и записью (гонка) или ошибка — заказ отменяем,
      // средства не списаны, товар не выдан.
      console.error('[orders] balance debit failed (race/insufficient):', balErr)
      await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
      return NextResponse.json(
        { error: 'Не удалось списать средства, повторите попытку' },
        { status: 409 }
      )
    }
    await supabaseAdmin.from('balance_transactions').insert({
      user_id: authUser.id,
      amount: -finalAmount,
      type: 'purchase',
      description: `Оплата заказа ${orderNumber}`,
      order_id: order.id,
    })

    // 6) Создание позиций + выдача (Контур B).
    const deliveredItems: Array<{ product_name: string; voucher_code: string }> = []
    let traceId: string | undefined
    let allInstantDelivered = true

    for (const line of lines) {
      const { product, quantity } = line
      let voucherCode: string | null = null
      let deliveryStatus: 'pending' | 'delivered' | 'failed' = 'pending'

      if (product.type === 'instant') {
        try {
          const delivered = await deliverInstant(product, quantity, referenceId, line.formData)
          if (delivered.length) {
            voucherCode = delivered.join('\n')
            deliveryStatus = 'delivered'
            deliveredItems.push({ product_name: product.name, voucher_code: voucherCode })
          } else {
            allInstantDelivered = false
          }
        } catch (e) {
          allInstantDelivered = false
          deliveryStatus = 'failed'
          if (e instanceof AppRouteError) traceId = e.traceId || traceId
          console.error('[orders] delivery failed:', e instanceof Error ? e.message : e)
        }
      } else {
        // topup/manual — обрабатывает менеджер/асинхронный поток.
        allInstantDelivered = false
      }

      await supabaseAdmin.from('order_items').insert({
        order_id: order.id,
        product_id: isUuid(product.id) ? product.id : null, // фолбэк-id не FK
        product_name: product.name,
        quantity,
        price: line.linePrice,
        voucher_code: voucherCode,
        delivery_status: deliveryStatus,
      })
    }

    const newStatus = deliveredItems.length === lines.length && allInstantDelivered ? 'delivered' : 'paid'
    await supabaseAdmin
      .from('orders')
      .update({ status: newStatus, supplier_trace_id: traceId || null })
      .eq('id', order.id)

    // 7) Реферальные начисления (процент по типу товара из настроек).
    if (profile.referred_by) {
      await creditReferral(profile.referred_by, authUser.id, order.id, orderNumber, lines)
    }

    // 8) Уведомление о выдаче (ТЗ §5.8) — только для фактически выданных моментальных позиций.
    //    Best-effort: notify сам гасит ошибки (бот заблокирован/таймаут/нет привязки) и не валит заказ.
    //    Идемпотентность: выдача в потоке создания происходит ровно один раз на заказ.
    if (deliveredItems.length > 0) {
      await notifyOrderDelivered(
        authUser.id,
        { order_number: orderNumber },
        deliveredItems.map((d) => ({ product_name: d.product_name, voucher_code: d.voucher_code }))
      )
    }

    // 9) Промокод: увеличить счётчик использований.
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

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        order_number: orderNumber,
        status: newStatus,
        total_amount: totalAmount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        delivered_items: deliveredItems,
      },
    })
  } catch (error) {
    console.error('[orders] unexpected error:', error)
    return NextResponse.json({ error: 'Ошибка создания заказа' }, { status: 500 })
  }
}

/** Выдача моментального товара: AppRoute (shop), Dessly (gift) или локальные ключи из файла. */
async function deliverInstant(
  product: Product,
  quantity: number,
  referenceId: string,
  formData?: Record<string, string>
): Promise<string[]> {
  // AppRoute shop: создать заказ → дождаться терминального статуса → unhide.
  if (product.supplier === 'approute' && product.denomination_id) {
    const created = await createShopOrder(referenceId, product.denomination_id, quantity)
    const orderId = created.data?.orderId
    await waitForOrder({ orderId, referenceId })
    const codes = await unhideVouchers({ orderId, referenceId })
    if (codes.length) return codes
    throw new AppRouteError('Voucher not available yet', 0 as never, 0, created.traceId)
  }

  // Dessly: отправка игры гифтом (нужен получатель).
  if (product.supplier === 'dessly' && product.supplier_id) {
    const recipient = formData?.recipient || formData?.account_reference || ''
    const res = await sendGift({ gameId: product.supplier_id, recipient, referenceId })
    if (res.status === 'failed') throw new DesslyError(res.message || 'Gift failed', 502)
    return [res.giftLink || `Заказ отправлен: ${res.transactionId}`]
  }

  // Локальные ключи (тип 1а — из файла).
  const out: string[] = []
  for (let i = 0; i < quantity; i++) {
    const { data: key } = await supabaseAdmin
      .from('product_keys')
      .select('*')
      .eq('product_id', product.id)
      .eq('is_used', false)
      .limit(1)
      .maybeSingle()
    if (!key) break
    const { error } = await supabaseAdmin
      .from('product_keys')
      .update({ is_used: true, used_at: new Date().toISOString() })
      .eq('id', key.id)
      .eq('is_used', false) // защита от гонки
    if (!error) out.push(key.key_value)
  }
  return out
}

async function creditReferral(
  referrerId: string,
  referredUserId: string,
  orderId: string,
  orderNumber: string,
  lines: Array<{ product: Product; linePrice: number }>
) {
  // Защита от самореферала: нельзя начислить бонус самому себе.
  if (!referrerId || referrerId === referredUserId) return

  // Процент зависит от типа товара (referral_settings, фолбэк на константы).
  const { data: settings } = await supabaseAdmin.from('referral_settings').select('*')
  const percentByType = new Map<string, number>()
  for (const s of settings || []) percentByType.set(s.product_type, Number(s.percent))

  const bonus = computeReferralBonus(
    lines.map((l) => ({ type: l.product.type, linePrice: l.linePrice })),
    percentByType,
    REFERRAL_PERCENTS
  )
  if (bonus <= 0) return

  const { data: referrer } = await supabaseAdmin
    .from('users')
    .select('balance')
    .eq('id', referrerId)
    .single()
  if (!referrer) return

  await supabaseAdmin
    .from('users')
    .update({ balance: Number(referrer.balance) + bonus })
    .eq('id', referrerId)
  await supabaseAdmin.from('referral_earnings').insert({
    referrer_id: referrerId,
    referred_user_id: referredUserId,
    order_id: orderId,
    amount: bonus,
  })
  await supabaseAdmin.from('balance_transactions').insert({
    user_id: referrerId,
    amount: bonus,
    type: 'referral',
    description: `Реферальный бонус за заказ ${orderNumber}`,
    order_id: orderId,
  })
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
