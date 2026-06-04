import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  buy as px6Buy,
  getCount,
  getPrice,
  isValidVersion,
  isPx6InsufficientFunds,
  Px6Error,
  type ProxyVersion,
} from '@/lib/px6'
import { loadProxySettings, proxyPriceRub, validateProxyRequest } from '@/lib/proxy-pricing'

/**
 * POST /api/proxy/buy — БОЕВАЯ покупка прокси через px6.
 *
 * БЕЗОПАСНОСТЬ ДЕНЕГ (хол­д → подтверждение / компенсация):
 *   1. Цена считается на СЕРВЕРЕ (наценка из proxy_settings) — клиенту не доверяем.
 *   2. Идемпотентность: idempotency_key (UNIQUE на proxy_orders) — повторный клик не покупает
 *      дважды; вставка строки-«claim» атомарно защищает от гонки.
 *   3. ХОЛД: списываем баланс CAS-обновлением ДО обращения к px6 (резерв средств).
 *   4. Покупка у px6. Успех → фиксируем заказ + выданные прокси (status paid).
 *   5. КОМПЕНСАЦИЯ: любая ошибка px6 → возвращаем деньги на баланс, заказ → failed/refunded.
 *      Нехватка средств на балансе px6 (error_id 400) → заказ не проводится, владельцу пополнить.
 *
 * Деньги списываются с пользователя только если прокси реально выданы; иначе полный возврат.
 */
export const maxDuration = 30

interface BuyBody {
  version?: number
  country?: string
  count?: number
  period?: number
  type?: string
  idempotency_key?: string
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

    const body = (await request.json().catch(() => null)) as BuyBody | null
    if (!body) {
      return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
    }

    const version = Number(body.version)
    const country = (body.country || '').trim().toLowerCase()
    const count = Number(body.count)
    const period = Number(body.period)
    const proxyType = body.type === 'socks' ? 'socks' : body.type === 'http' ? 'http' : undefined
    // Ключ идемпотентности: принимаем от клиента (стабильный на один клик), иначе генерируем.
    const idempotencyKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.length >= 8
        ? body.idempotency_key.slice(0, 80)
        : randomUUID()

    if (!isValidVersion(version)) {
      return NextResponse.json({ error: 'Некорректная версия прокси' }, { status: 400 })
    }
    if (!country) {
      return NextResponse.json({ error: 'Не указана страна' }, { status: 400 })
    }

    const settings = await loadProxySettings()
    if (!settings.is_enabled) {
      return NextResponse.json({ error: 'Покупка прокси временно недоступна' }, { status: 503 })
    }
    const valid = validateProxyRequest(count, period, settings)
    if (!valid.ok) {
      return NextResponse.json({ error: valid.error }, { status: 400 })
    }

    // 0) Идемпотентность: если по этому ключу уже есть заказ — не покупаем второй раз.
    const { data: existing } = await supabaseAdmin
      .from('proxy_orders')
      .select('id, status, proxies, price_internal')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    if (existing) {
      if (existing.status === 'paid') {
        return NextResponse.json({
          success: true,
          duplicate: true,
          order_id: existing.id,
          proxies: existing.proxies || [],
          price: Number(existing.price_internal),
        })
      }
      // pending — покупка ещё идёт; failed/refunded — прошлая попытка не удалась.
      return NextResponse.json(
        { error: existing.status === 'pending' ? 'Покупка уже выполняется' : 'Предыдущая попытка не удалась, обновите страницу' },
        { status: 409 }
      )
    }

    // 1) Наличие у px6.
    const available = await getCount(country, version as ProxyVersion)
    if (available < count) {
      return NextResponse.json(
        { error: available <= 0 ? 'Нет в наличии' : `Доступно только ${available}` },
        { status: 409 }
      )
    }

    // 2) Цена на сервере (наценка из настроек).
    const px6Price = await getPrice(count, period, version as ProxyVersion)
    const priceRub = proxyPriceRub(
      px6Price.price,
      px6Price.currency,
      settings.markup_percent,
      settings.usd_to_rub_rate
    )
    if (priceRub <= 0) {
      return NextResponse.json({ error: 'Не удалось рассчитать стоимость' }, { status: 502 })
    }

    // 3) Профиль + проверка баланса.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('users')
      .select('id, balance')
      .eq('id', authUser.id)
      .single()
    if (profileErr || !profile) {
      return NextResponse.json({ error: 'Профиль не найден' }, { status: 404 })
    }
    if (Number(profile.balance) < priceRub) {
      return NextResponse.json({ error: 'Недостаточно средств на балансе' }, { status: 400 })
    }

    // 4) Claim: вставляем заказ (pending) с idempotency_key. UNIQUE-ключ атомарно отсекает гонку
    //    двух одновременных кликов: второй упадёт на конфликте — вернём 409.
    const { data: order, error: insertErr } = await supabaseAdmin
      .from('proxy_orders')
      .insert({
        user_id: authUser.id,
        version,
        country,
        count,
        period,
        proxy_type: proxyType ?? null,
        price_internal: priceRub,
        status: 'pending',
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single()
    if (insertErr || !order) {
      // 23505 — unique_violation (гонка по idempotency_key).
      const code = (insertErr as { code?: string } | null)?.code
      if (code === '23505') {
        return NextResponse.json({ error: 'Покупка уже выполняется' }, { status: 409 })
      }
      console.error('[proxy/buy] claim insert failed:', insertErr)
      return NextResponse.json({ error: 'Не удалось создать заказ' }, { status: 500 })
    }

    // 5) ХОЛД: списываем баланс CAS-обновлением (как в /api/orders/create). Защищает от гонки
    //    и от ухода в минус. Делаем ДО обращения к px6 — резерв средств.
    const { data: debited, error: balErr } = await supabaseAdmin
      .from('users')
      .update({ balance: Number(profile.balance) - priceRub })
      .eq('id', authUser.id)
      .eq('balance', profile.balance)
      .gte('balance', priceRub)
      .select('id')
      .maybeSingle()
    if (balErr || !debited) {
      // Баланс изменился между чтением и записью (гонка) или ошибка — заказ отменяем, не покупаем.
      await supabaseAdmin.from('proxy_orders').update({ status: 'failed' }).eq('id', order.id)
      return NextResponse.json(
        { error: 'Не удалось списать средства, повторите попытку' },
        { status: 409 }
      )
    }
    await supabaseAdmin.from('balance_transactions').insert({
      user_id: authUser.id,
      amount: -priceRub,
      type: 'purchase',
      description: `Покупка прокси px6 (${count} шт., ${period} дн., ${country.toUpperCase()})`,
      order_id: null,
    })

    // 6) Покупка у px6.
    let bought
    try {
      bought = await px6Buy({
        count,
        period,
        country,
        version: version as ProxyVersion,
        type: proxyType,
        descr: idempotencyKey, // ключ идемпотентности кладём в descr заказа px6
      })
    } catch (e) {
      // КОМПЕНСАЦИЯ: возвращаем удержанные средства, заказ → failed/refunded.
      await refundHold(authUser.id, priceRub, count, period, country, order.id)
      if (isPx6InsufficientFunds(e)) {
        // Деньги покупателю возвращены; владельцу — пополнить баланс px6.
        console.error('[proxy/buy] px6 insufficient funds (error 400) — top up px6 balance')
        return NextResponse.json(
          { error: 'Покупка временно недоступна. Попробуйте позже.' },
          { status: 503 }
        )
      }
      const msg = e instanceof Px6Error ? e.message : 'Ошибка при покупке прокси'
      console.error('[proxy/buy] px6 buy failed:', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // Аномалия: px6 ответил успехом, но без прокси — считаем покупку несостоявшейся, возврат.
    if (!bought.proxies || bought.proxies.length === 0) {
      await refundHold(authUser.id, priceRub, count, period, country, order.id)
      return NextResponse.json({ error: 'Поставщик не выдал прокси, средства возвращены' }, { status: 502 })
    }

    // 7) Успех: фиксируем заказ + выданные прокси.
    await supabaseAdmin
      .from('proxy_orders')
      .update({
        status: 'paid',
        px6_order_id: bought.orderId ?? null,
        px6_price: bought.price || null,
        px6_currency: bought.currency,
        proxies: bought.proxies,
      })
      .eq('id', order.id)

    return NextResponse.json({
      success: true,
      order_id: order.id,
      price: priceRub,
      count: bought.proxies.length,
      proxies: bought.proxies,
    })
  } catch (error) {
    console.error('[proxy/buy] unexpected error:', error)
    return NextResponse.json({ error: 'Ошибка покупки прокси' }, { status: 500 })
  }
}

/**
 * Компенсация холда: возвращаем удержанные средства на баланс пользователя и помечаем заказ
 * refunded. Читаем актуальный баланс (не CAS — это начисление, гонок на увеличение нет).
 */
async function refundHold(
  userId: string,
  amount: number,
  count: number,
  period: number,
  country: string,
  proxyOrderId: string
): Promise<void> {
  try {
    const { data: cur } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', userId)
      .single()
    if (cur) {
      await supabaseAdmin
        .from('users')
        .update({ balance: Number(cur.balance) + amount })
        .eq('id', userId)
      await supabaseAdmin.from('balance_transactions').insert({
        user_id: userId,
        amount,
        type: 'refund',
        description: `Возврат за прокси px6 (${count} шт., ${period} дн., ${country.toUpperCase()})`,
        order_id: null,
      })
    }
    await supabaseAdmin.from('proxy_orders').update({ status: 'refunded' }).eq('id', proxyOrderId)
  } catch (e) {
    // Возврат — best-effort; при сбое останется заметным расхождением в логах для ручной сверки.
    console.error('[proxy/buy] refundHold failed:', e instanceof Error ? e.message : e)
  }
}
