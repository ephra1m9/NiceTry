import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/users/[id] - получение пользователя
export async function GET(
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

    const { data: targetUser, error } = await supabase
      .from('users')
      .select(`
        *,
        user_statuses (name, discount_percent)
      `)
      .eq('id', params.id)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Получаем статистику пользователя
    const { data: orders, count: ordersCount } = await supabase
      .from('orders')
      .select('final_amount', { count: 'exact' })
      .eq('user_id', params.id)

    const totalSpent = orders?.reduce((sum, order) => sum + Number(order.final_amount), 0) || 0

    const { count: referralsCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', params.id)

    return NextResponse.json({
      user: {
        ...targetUser,
        stats: {
          orders_count: ordersCount || 0,
          total_spent: totalSpent,
          referrals_count: referralsCount || 0,
        },
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/admin/users/[id] - обновление пользователя
export async function PATCH(
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

    const body = await request.json()

    // Обновляем пользователя
    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (body.balance !== undefined) {
      updateData.balance = body.balance
    }

    if (body.status_id !== undefined) {
      updateData.status_id = body.status_id
    }

    if (body.is_admin !== undefined) {
      updateData.is_admin = body.is_admin
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Если изменён баланс, создаём транзакцию
    if (body.balance !== undefined && body.balance_reason) {
      const { data: currentUser } = await supabase
        .from('users')
        .select('balance')
        .eq('id', params.id)
        .single()

      const balanceDiff = Number(body.balance) - Number(currentUser?.balance || 0)

      if (balanceDiff !== 0) {
        await supabase.from('balance_transactions').insert({
          user_id: params.id,
          amount: Math.abs(balanceDiff),
          type: 'admin',
          description: body.balance_reason,
        })
      }
    }

    return NextResponse.json({ user: updatedUser })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
