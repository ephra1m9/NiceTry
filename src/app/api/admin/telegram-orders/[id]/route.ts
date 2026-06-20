import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PatchBody {
  status?: 'completed' | 'failed'
}

/**
 * PATCH /api/admin/telegram-orders/[id] — отметить заявку выданной либо отменить с возвратом.
 *
 * Переход разрешён только из pending (ручная выдача — единственный шаг после оплаты):
 *   - completed: звёзды/Premium отправлены получателю, ничего больше не делаем.
 *   - failed: выдать не получилось — возвращаем price_rub на баланс покупателя
 *     (balance_transactions: type='refund') и фиксируем отмену.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const admin = guard.admin

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body || (body.status !== 'completed' && body.status !== 'failed')) {
      return NextResponse.json({ error: 'Некорректный статус' }, { status: 400 })
    }

    const { data: order, error: fetchErr } = await admin
      .from('telegram_orders')
      .select('id, user_id, price_rub, status')
      .eq('id', params.id)
      .single()
    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
    }
    if (order.status !== 'pending') {
      return NextResponse.json({ error: 'Заявка уже обработана' }, { status: 409 })
    }

    if (body.status === 'failed' && order.user_id) {
      const { data: profile } = await admin.from('users').select('balance').eq('id', order.user_id).single()
      if (profile) {
        await admin
          .from('users')
          .update({ balance: Number(profile.balance) + Number(order.price_rub) })
          .eq('id', order.user_id)
        await admin.from('balance_transactions').insert({
          user_id: order.user_id,
          amount: Number(order.price_rub),
          type: 'refund',
          description: 'Возврат за Telegram Stars/Premium (не удалось выдать)',
          order_id: null,
        })
      }
    }

    const { data: updated, error: updateErr } = await admin
      .from('telegram_orders')
      .update({ status: body.status })
      .eq('id', params.id)
      .select('id, status')
      .single()
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    return NextResponse.json({ order: updated })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
