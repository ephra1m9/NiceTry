import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createDtuOrder, waitForOrder, AppRouteError } from '@/lib/approute'
import {
  findTelegramPackage,
  loadTelegramSettings,
  telegramPriceRub,
  cleanAccountReference,
  BARE_USERNAME_RE,
  type TelegramPackage,
} from '@/lib/telegram-pricing'

/**
 * POST /api/telegram/buy — покупка Telegram Stars/Premium с баланса через AppRoute (direct_topup).
 *
 * Поток (хол­д → подтверждение / компенсация, как в /api/proxy/buy):
 *   1. Цена считается на сервере (пакет + наценка из telegram_settings) — клиенту не доверяем.
 *   2. Идемпотентность: idempotency_key (UNIQUE на telegram_orders), он же referenceId у AppRoute —
 *      повторный клик не покупает дважды ни у нас, ни у поставщика.
 *   3. ХОЛД: списываем баланс CAS-обновлением ДО обращения к AppRoute.
 *   4. createDtuOrder → ждём терминальный статус (waitForOrder, бюджет ~20с).
 *      SUCCESS/PARTIALLY_COMPLETED → completed. CANCELLED/ошибка → возврат, failed.
 *      Не успели дождаться (IN_PROGRESS) — заказ остаётся pending, деньги НЕ возвращаем
 *      (AppRoute заказ принял, это не провал) — добивает admin /admin/telegram-orders.
 */
export const maxDuration = 30

interface BuyBody {
  package_id?: string
  recipient_username?: string
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

    const pkg = await findTelegramPackage(String(body.package_id || ''))
    if (!pkg) {
      return NextResponse.json({ error: 'Некорректный пакет' }, { status: 400 })
    }

    const username = cleanAccountReference(String(body.recipient_username || ''))
    if (!BARE_USERNAME_RE.test(username)) {
      return NextResponse.json(
        { error: 'Укажите корректный Telegram-username получателя (5–32 символов: латиница, цифры, _)' },
        { status: 400 }
      )
    }

    // referenceId у AppRoute — 1..40 символов; используем тот же ключ, что и наша идемпотентность.
    const idempotencyKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.length >= 8 && body.idempotency_key.length <= 40
        ? body.idempotency_key
        : randomUUID()

    // Идемпотентность: повторный клик по тому же ключу не создаёт второй заказ/списание.
    const { data: existing } = await supabaseAdmin
      .from('telegram_orders')
      .select('id, status, price_rub')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    if (existing) {
      if (existing.status !== 'failed') {
        return NextResponse.json({
          success: true,
          duplicate: true,
          order_id: existing.id,
          price: Number(existing.price_rub),
          status: existing.status,
        })
      }
      return NextResponse.json({ error: 'Предыдущая попытка не удалась, обновите страницу' }, { status: 409 })
    }

    const settings = await loadTelegramSettings()
    const priceRub = telegramPriceRub(pkg.price_usd, settings.markup_percent, settings.usd_to_rub_rate)
    if (priceRub <= 0) {
      return NextResponse.json({ error: 'Не удалось рассчитать стоимость' }, { status: 502 })
    }

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

    // Claim: вставляем заказ (pending) с idempotency_key. UNIQUE-ключ атомарно отсекает гонку
    // двух одновременных кликов: второй упадёт на конфликте — вернём 409.
    const { data: order, error: insertErr } = await supabaseAdmin
      .from('telegram_orders')
      .insert({
        user_id: authUser.id,
        product_type: pkg.product_type,
        amount: pkg.amount,
        recipient_username: username,
        price_usd: pkg.price_usd,
        price_rub: priceRub,
        denomination_id: pkg.id,
        status: 'pending',
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single()
    if (insertErr || !order) {
      const code = (insertErr as { code?: string } | null)?.code
      if (code === '23505') {
        return NextResponse.json({ error: 'Покупка уже выполняется' }, { status: 409 })
      }
      console.error('[telegram/buy] claim insert failed:', insertErr)
      return NextResponse.json({ error: 'Не удалось создать заказ' }, { status: 500 })
    }

    // Списание баланса CAS-обновлением (как в /api/proxy/buy) — защищает от гонки и минуса.
    const { data: debited, error: balErr } = await supabaseAdmin
      .from('users')
      .update({ balance: Number(profile.balance) - priceRub })
      .eq('id', authUser.id)
      .eq('balance', profile.balance)
      .gte('balance', priceRub)
      .select('id')
      .maybeSingle()
    if (balErr || !debited) {
      await supabaseAdmin.from('telegram_orders').update({ status: 'failed' }).eq('id', order.id)
      return NextResponse.json({ error: 'Не удалось списать средства, повторите попытку' }, { status: 409 })
    }

    await supabaseAdmin.from('balance_transactions').insert({
      user_id: authUser.id,
      amount: -priceRub,
      type: 'purchase',
      description: `${pkg.product_type === 'stars' ? 'Telegram Stars' : 'Telegram Premium'} (${pkg.label}) для @${username}`,
      order_id: null,
    })

    // Покупка у AppRoute (direct top-up на account_reference).
    let created
    try {
      created = await createDtuOrder(idempotencyKey, pkg.id, [{ key: 'account_reference', value: username }])
    } catch (e) {
      await refundHold(authUser.id, priceRub, order.id, pkg)
      const msg = e instanceof AppRouteError ? e.message : 'Ошибка при покупке у поставщика'
      console.error('[telegram/buy] AppRoute createDtuOrder failed:', msg)
      return NextResponse.json({ error: 'Не удалось оформить покупку, средства возвращены' }, { status: 502 })
    }

    const supplierOrderId = created.data?.orderId ?? null
    await supabaseAdmin.from('telegram_orders').update({ supplier_order_id: supplierOrderId }).eq('id', order.id)

    const settled = await waitForOrder(
      { orderId: supplierOrderId ?? undefined, referenceId: idempotencyKey },
      { maxAttempts: 6, baseDelayMs: 1000, maxDelayMs: 5000 }
    )

    if (settled?.status === 'CANCELLED') {
      await refundHold(authUser.id, priceRub, order.id, pkg)
      return NextResponse.json({ error: 'Поставщик отменил заказ, средства возвращены' }, { status: 502 })
    }
    if (settled?.status === 'SUCCESS' || settled?.status === 'PARTIALLY_COMPLETED') {
      await supabaseAdmin.from('telegram_orders').update({ status: 'completed' }).eq('id', order.id)
      return NextResponse.json({ success: true, order_id: order.id, price: priceRub, status: 'completed' })
    }

    // Поставщик принял заказ, но статус ещё не терминальный — оставляем pending (не провал,
    // деньги не возвращаем). Дальше доводит /admin/telegram-orders.
    return NextResponse.json({ success: true, order_id: order.id, price: priceRub, status: 'pending' })
  } catch (error) {
    console.error('[telegram/buy] unexpected error:', error)
    return NextResponse.json({ error: 'Ошибка покупки' }, { status: 500 })
  }
}

/** Компенсация холда: возвращаем удержанные средства, заказ → failed. */
async function refundHold(userId: string, amount: number, orderId: string, pkg: TelegramPackage): Promise<void> {
  try {
    const { data: cur } = await supabaseAdmin.from('users').select('balance').eq('id', userId).single()
    if (cur) {
      await supabaseAdmin
        .from('users')
        .update({ balance: Number(cur.balance) + amount })
        .eq('id', userId)
      await supabaseAdmin.from('balance_transactions').insert({
        user_id: userId,
        amount,
        type: 'refund',
        description: `Возврат за Telegram (${pkg.label})`,
        order_id: null,
      })
    }
    await supabaseAdmin.from('telegram_orders').update({ status: 'failed' }).eq('id', orderId)
  } catch (e) {
    console.error('[telegram/buy] refundHold failed:', e instanceof Error ? e.message : e)
  }
}
