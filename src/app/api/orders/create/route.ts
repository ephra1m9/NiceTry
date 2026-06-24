import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildCatalogProducts, buildCategories, priceRub } from '@/lib/catalog'
import { AppRouteError } from '@/lib/approute'
import { resolvePackage } from '@/lib/dessly'
import { deliverInstant, DeliveryPendingError } from '@/lib/delivery'
import { safeGetOrCreateChat, safePostSystemMessage } from '@/lib/chat'
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
  proportionalRefund,
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

// Выдача гифта Dessly опрашивает статус с паузами (до ~15с). Поднимаем лимит выполнения
// функции, чтобы поллинг успевал завершиться до таймаута платформы.
export const maxDuration = 60

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
      let linePrice = priced.linePrice

      // Dessly-гифты: живой каталог игр НЕ отдаёт цену (она зависит от издания/региона),
      // поэтому product.price = 0 и computeLinePrice вернёт 0. Резолвим реальную цену в USD
      // по app_id + регион + издание и переводим в ₽ по курсу/наценке категории dessly-games.
      // Делаем это на сервере (клиенту нельзя доверять сумму) ДО списания баланса.
      if (product.supplier === 'dessly' && linePrice <= 0) {
        const resolved = await resolveDesslyLinePrice(product, item.form_data)
        if (!resolved.ok) {
          return NextResponse.json({ error: resolved.error }, { status: 400 })
        }
        linePrice = resolved.priceRub * qty.quantity
      }

      lines.push({ product, quantity: qty.quantity, linePrice, formData: item.form_data })
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
    // Позиции без авто-выдачи (topup/manual, асинхронные DeliveryPendingError) — для summary
    // сообщения в чат заказа: их закроет менеджер.
    const pendingNames: string[] = []
    // Позиции, за которые покупатель реально платит (выданные + ручные в работе) — без
    // проваленных/возвращённых: только по ним начисляется реферальный бонус.
    const chargedLines: Line[] = []
    let traceId: string | undefined
    let allInstantDelivered = true
    // Сумма проваленных моментальных позиций (для возврата на баланс) и счётчик асинхронных
    // позиций (topup/manual — их обрабатывает менеджер, это НЕ провал).
    let failedLineTotal = 0
    let pendingCount = 0

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
            deliveryStatus = 'failed'
            failedLineTotal += line.linePrice
          }
        } catch (e) {
          if (e instanceof DeliveryPendingError) {
            // Поставщик принял заказ, выдача ещё идёт — НЕ провал, возврат не делаем.
            // Позиция остаётся pending; заказ останется в работе (paid), деньги списаны.
            allInstantDelivered = false
            deliveryStatus = 'pending'
            pendingCount += 1
            traceId = e.transactionId || traceId
          } else {
            allInstantDelivered = false
            deliveryStatus = 'failed'
            failedLineTotal += line.linePrice
            if (e instanceof AppRouteError) traceId = e.traceId || traceId
            console.error('[orders] delivery failed:', e instanceof Error ? e.message : e)
          }
        }
      } else {
        // topup/manual — обрабатывает менеджер/асинхронный поток (ожидаемо pending, не провал).
        allInstantDelivered = false
        pendingCount += 1
      }

      if (deliveryStatus !== 'failed') chargedLines.push(line)
      if (deliveryStatus === 'pending') pendingNames.push(product.name)

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

    // Статус заказа:
    //  - всё моментальное выдано → delivered;
    //  - ничего не выдано, нет ожидающих ручных позиций, но есть провалы → cancelled (полный возврат);
    //  - иначе → paid (есть выданное и/или ручные позиции в работе).
    let newStatus: 'delivered' | 'paid' | 'cancelled'
    if (deliveredItems.length === lines.length && allInstantDelivered) {
      newStatus = 'delivered'
    } else if (deliveredItems.length === 0 && pendingCount === 0 && failedLineTotal > 0) {
      newStatus = 'cancelled'
    } else {
      newStatus = 'paid'
    }

    // Чат заказа: создаём, если есть хоть что-то, что покупатель реально получит/ждёт
    // (cancelled = полный возврат, переписываться там не о чём). Авто-выданные позиции
    // приходят системным сообщением с кодом; позиции без авто-выдачи — одним summary.
    if (newStatus !== 'cancelled') {
      const chatResult = await safeGetOrCreateChat(order.id, authUser.id)
      if (chatResult) {
        const { chat } = chatResult
        // Одно сообщение на все выданные позиции — меньше round-trip'ов на заказ, чище в чате.
        if (deliveredItems.length > 0) {
          const lines = deliveredItems.map((d) => `📦 ${d.product_name}\n🔑 ${d.voucher_code}`)
          await safePostSystemMessage(chat.id, lines.join('\n\n'))
        }
        if (pendingNames.length > 0) {
          await safePostSystemMessage(
            chat.id,
            `⏳ Эти позиции в обработке у менеджера, ожидайте сообщения здесь:\n${pendingNames.map((n) => `• ${n}`).join('\n')}`
          )
        }
      }
    }

    // Возврат на баланс за непоставленные (failed) позиции (ТЗ §5.4): пропорционально их доле
    // в финальной сумме. Делаем ДО смены статуса, чтобы при сбое не оставить деньги списанными.
    const refundAmount = proportionalRefund(finalAmount, failedLineTotal, totalAmount)
    if (refundAmount > 0) {
      const { data: cur } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', authUser.id)
        .single()
      if (cur) {
        await supabaseAdmin
          .from('users')
          .update({ balance: Number(cur.balance) + refundAmount })
          .eq('id', authUser.id)
        await supabaseAdmin.from('balance_transactions').insert({
          user_id: authUser.id,
          amount: refundAmount,
          type: 'refund',
          description: `Возврат за непоставленные позиции заказа ${orderNumber}`,
          order_id: order.id,
        })
      }
    }

    await supabaseAdmin
      .from('orders')
      .update({ status: newStatus, supplier_trace_id: traceId || null })
      .eq('id', order.id)

    // 7) Реферальные начисления (процент по типу товара из настроек) — только по оплаченным
    //    (не возвращённым) позициям.
    if (profile.referred_by && chargedLines.length) {
      await creditReferral(profile.referred_by, authUser.id, order.id, orderNumber, chargedLines)
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

/**
 * Реальная цена Dessly-гифта в ₽ для строки заказа.
 * Живой каталог игр не несёт цену — резолвим её по app_id + регион + издание (USD),
 * затем переводим в ₽ по курсу/наценке категории dessly-games (как в каталоге).
 * Курс/наценку берём из БД (admin-editable), с фолбэком на конфиг каталога.
 */
async function resolveDesslyLinePrice(
  product: Product,
  formData?: Record<string, string>
): Promise<{ ok: true; priceRub: number } | { ok: false; error: string }> {
  const gameId = product.supplier_id || product.denomination_id || product.supplier_service_id
  if (!gameId) return { ok: false, error: 'Не удалось определить игру для расчёта цены' }

  const region = (formData?.region || 'RU').toUpperCase()
  const editionName = formData?.edition || undefined

  let pkg: Awaited<ReturnType<typeof resolvePackage>>
  try {
    pkg = await resolvePackage(gameId, region, editionName)
  } catch (e) {
    console.error('[orders] resolveDesslyLinePrice failed:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'Не удалось получить цену издания. Попробуйте ещё раз.' }
  }
  if (!pkg || !(pkg.price > 0)) {
    return { ok: false, error: `Издание/регион ${region} недоступны для этой игры` }
  }

  // Курс и наценка категории dessly-games: из БД (актуальные правки админа), фолбэк — конфиг.
  let rate = 0
  let markup = 0
  const { data: cat } = await supabaseAdmin
    .from('categories')
    .select('usd_to_rub_rate, markup_percent')
    .eq('slug', 'dessly-games')
    .maybeSingle()
  if (cat && Number(cat.usd_to_rub_rate) > 0) {
    rate = Number(cat.usd_to_rub_rate)
    markup = Number(cat.markup_percent || 0)
  } else {
    const fallback = buildCategories().find((c) => c.slug === 'dessly-games')
    rate = fallback?.usd_to_rub_rate ?? 82
    markup = fallback?.markup_percent ?? 18
  }

  return { ok: true, priceRub: priceRub(pkg.price, rate, markup) }
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
