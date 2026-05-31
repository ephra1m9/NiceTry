import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/orders/[id]
 * Получить информацию о заказе
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { id } = params

    // Проверка авторизации
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Получаем заказ
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Заказ не найден' },
        { status: 404 }
      )
    }

    // Проверка прав доступа
    if (order.user_id !== user.id) {
      // Проверяем, является ли пользователь администратором
      const { data: userProfile } = await supabase
        .from('users')
        .select('is_admin')
        .eq('id', user.id)
        .single()

      if (!userProfile?.is_admin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Получаем позиции заказа
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', id)
      .order('created_at', { ascending: true })

    if (itemsError) {
      console.error('Error fetching order items:', itemsError)
    }

    return NextResponse.json({
      order: {
        ...order,
        items: items || [],
      },
    })
  } catch (error) {
    console.error('Order fetch error:', error)
    return NextResponse.json(
      { error: 'Ошибка получения заказа' },
      { status: 500 }
    )
  }
}
