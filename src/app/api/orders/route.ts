import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/orders — список заказов текущего пользователя.
 *
 * Авторизацию проверяем по сессии, а сами данные тянем через service-role клиент,
 * жёстко ограничивая выборку .eq('user_id', user.id). Это нужно, чтобы подтянуть
 * применённый промокод: таблица promo_codes полностью закрыта RLS для обычных
 * пользователей, поэтому встроенный join из клиента вернул бы null.
 *
 * orders + order_items (+ применённый промокод), сортировка от новых к старым,
 * пагинация через ?page & ?limit. Используется в разделе «Заказы» профиля
 * (сайт и Mini App).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sp = request.nextUrl.searchParams
    const limit = Math.min(Math.max(parseInt(sp.get('limit') || '10', 10) || 10, 1), 50)
    const page = Math.max(parseInt(sp.get('page') || '1', 10) || 1, 1)
    const from = (page - 1) * limit
    const to = from + limit - 1

    const { data, error, count } = await supabaseAdmin
      .from('orders')
      .select(
        `
        id,
        order_number,
        status,
        total_amount,
        discount_amount,
        final_amount,
        payment_method,
        created_at,
        items:order_items (
          id,
          product_name,
          quantity,
          price,
          voucher_code,
          delivery_status
        ),
        promo:promo_codes ( code )
      `,
        { count: 'exact' }
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .order('created_at', { ascending: true, foreignTable: 'order_items' })
      .range(from, to)

    if (error) {
      console.error('[orders] list error:', error)
      return NextResponse.json({ error: 'Не удалось загрузить заказы' }, { status: 500 })
    }

    const total = count ?? 0
    return NextResponse.json({
      orders: data || [],
      page,
      limit,
      total,
      hasMore: to + 1 < total,
    })
  } catch (error) {
    console.error('[orders] list unexpected error:', error)
    return NextResponse.json({ error: 'Ошибка получения заказов' }, { status: 500 })
  }
}
