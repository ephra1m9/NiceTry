import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { notifyBalanceTopup } from '@/lib/telegram/notify'

// GET /api/admin/users/[id] - получение пользователя
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

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
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
    }

    // Состояние ДО изменений — нужно для корректного расчёта дельты баланса.
    const { data: before, error: beforeError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', params.id)
      .single()
    if (beforeError || !before) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    // Рассчитываем дельту баланса ДО обновления (иначе она всегда была бы 0).
    let balanceDiff = 0
    if (body.balance !== undefined) {
      const newBalance = Number(body.balance)
      if (!Number.isFinite(newBalance) || newBalance < 0) {
        return NextResponse.json({ error: 'Некорректный баланс' }, { status: 400 })
      }
      balanceDiff = newBalance - Number(before.balance || 0)
      // Ручная корректировка баланса требует указания причины (ТЗ §5.6).
      if (balanceDiff !== 0 && !body.balance_reason) {
        return NextResponse.json({ error: 'Укажите причину изменения баланса' }, { status: 400 })
      }
      updateData.balance = newBalance
    }

    if (body.status_id !== undefined) {
      updateData.status_id = body.status_id
    }

    if (body.is_admin !== undefined) {
      updateData.is_admin = Boolean(body.is_admin)
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

    // Транзакция корректировки баланса — со знаком (+/−), чтобы история была корректной.
    if (balanceDiff !== 0) {
      await supabase.from('balance_transactions').insert({
        user_id: params.id,
        amount: balanceDiff,
        type: 'admin',
        description: body.balance_reason,
      })
      // Уведомление о пополнении (ТЗ §5.8) — только при положительной дельте. Best-effort.
      if (balanceDiff > 0) {
        await notifyBalanceTopup(params.id, balanceDiff, Number(updatedUser.balance))
      }
    }

    return NextResponse.json({ user: updatedUser })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
