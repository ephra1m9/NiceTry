import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/admin/orders/[id]/refund - возврат средств
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()

    // Проверка прав администратора
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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

    // Возвращаем средства пользователю
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

    // Обновляем статус заказа
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      order: updatedOrder,
      refunded_amount: order.final_amount,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
