import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { notifyRefund } from '@/lib/telegram/notify'

// POST /api/admin/orders/[id]/refund - возврат средств
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    // Получаем заказ
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', params.id)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Order already cancelled' },
        { status: 400 }
      )
    }

    // Атомарно переводим заказ в cancelled с защитой от повторного возврата (гонка):
    // условие .neq('cancelled') гарантирует, что только ОДИН параллельный запрос
    // выполнит флип; остальные получат 0 строк и не начислят возврат повторно.
    const { data: flipped, error: flipError } = await supabase
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .neq('status', 'cancelled')
      .select()
      .single()

    if (flipError || !flipped) {
      // Кто-то уже отменил заказ между чтением и записью — повторный возврат не делаем.
      return NextResponse.json({ error: 'Order already cancelled' }, { status: 400 })
    }

    // Возвращаем средства пользователю (на внутренний баланс — ТЗ §8.1).
    const { data: userBalance, error: balanceError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', order.user_id)
      .single()

    if (balanceError) {
      return NextResponse.json({ error: balanceError.message }, { status: 500 })
    }

    const newBalance = Number(userBalance.balance) + Number(order.final_amount)

    // Обновляем баланс
    await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', order.user_id)

    // Создаём транзакцию
    await supabase.from('balance_transactions').insert({
      user_id: order.user_id,
      amount: order.final_amount,
      type: 'refund',
      description: `Возврат за заказ #${order.order_number}`,
      order_id: order.id,
    })

    // Уведомление о возврате (ТЗ §5.8). Идемпотентно: атомарный флип в cancelled выше
    // выполняется ровно один раз, поэтому notify тоже сработает один раз.
    if (order.user_id) {
      await notifyRefund(order.user_id, { order_number: order.order_number }, Number(order.final_amount))
    }

    return NextResponse.json({
      success: true,
      order: flipped,
      refunded_amount: order.final_amount,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
