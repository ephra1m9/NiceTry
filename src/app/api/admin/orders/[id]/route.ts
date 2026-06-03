import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { notifyOrderDelivered } from '@/lib/telegram/notify'

// GET /api/admin/orders/[id] - получение деталей заказа
export async function GET(
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
      .select(`
        *,
        users (id, email, telegram_username, balance)
      `)
      .eq('id', params.id)
      .single()

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 })
    }

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Получаем позиции заказа
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', params.id)

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    return NextResponse.json({ order: { ...order, items } })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/admin/orders/[id] - обновление статуса заказа
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const body = await request.json()

    // Ручной перевод в «выдан» (ТЗ §5.6/§5.8): уведомление шлём РОВНО при переходе в delivered.
    // Атомарное условие .neq('status','delivered') гарантирует, что только один запрос реально
    // переведёт заказ и отправит уведомление — повторные PATCH дублей не породят (идемпотентность).
    if (body.status === 'delivered') {
      const { data: flipped, error: flipErr } = await supabase
        .from('orders')
        .update({
          status: 'delivered',
          delivery_data: body.delivery_data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.id)
        .neq('status', 'delivered')
        .select()
        .maybeSingle()

      if (flipErr) return NextResponse.json({ error: flipErr.message }, { status: 500 })

      if (flipped) {
        // Переход состоялся — уведомляем покупателя (best-effort, ошибки гасятся внутри notify).
        const { data: items } = await supabase
          .from('order_items')
          .select('product_name, voucher_code')
          .eq('order_id', params.id)
        if (flipped.user_id) {
          await notifyOrderDelivered(
            flipped.user_id,
            { order_number: flipped.order_number },
            (items || []) as Array<{ product_name: string; voucher_code?: string | null }>
          )
        }
        return NextResponse.json({ order: flipped })
      }

      // Уже был delivered — возвращаем текущее состояние без повторного уведомления.
      const { data: current } = await supabase.from('orders').select().eq('id', params.id).single()
      return NextResponse.json({ order: current })
    }

    const { data: order, error } = await supabase
      .from('orders')
      .update({
        status: body.status,
        delivery_data: body.delivery_data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ order })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
