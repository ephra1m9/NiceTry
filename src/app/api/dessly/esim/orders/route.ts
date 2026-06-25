import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/dessly/esim/orders — купленные eSIM текущего пользователя.
 *
 * eSIM не лежит в общем каталоге и не имеет своей таблицы (см. /api/dessly/esim/order) —
 * заказ создаётся как обычный orders + один order_items с form_data.type === 'esim'
 * (variant_id, product_id, country, plan_label). Тянем через orders!inner-фильтр по
 * вложенному order_items, авторизация по сессии, данные через service-role
 * с жёстким .eq('user_id', user.id).
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
    const limit = Math.min(Math.max(parseInt(sp.get('limit') || '20', 10) || 20, 1), 100)
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
        final_amount,
        created_at,
        items:order_items!inner (
          voucher_code,
          delivery_status,
          form_data
        )
      `,
        { count: 'exact' }
      )
      .eq('user_id', user.id)
      .eq('items.form_data->>type', 'esim')
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[dessly/esim/orders] list error:', error)
      return NextResponse.json({ error: 'Не удалось загрузить eSIM' }, { status: 500 })
    }

    const orders = (data || []).map((o) => {
      const item = (o.items as { voucher_code: string | null; delivery_status: string; form_data: Record<string, string> | null }[])[0]
      const formData = item?.form_data || {}
      return {
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        final_amount: o.final_amount,
        created_at: o.created_at,
        country: formData.country || null,
        plan_label: formData.plan_label || null,
        delivery_status: item?.delivery_status || 'pending',
        voucher_code: item?.voucher_code || null,
      }
    })

    const total = count ?? 0
    return NextResponse.json({
      orders,
      page,
      limit,
      total,
      hasMore: to + 1 < total,
    })
  } catch (error) {
    console.error('[dessly/esim/orders] unexpected error:', error)
    return NextResponse.json({ error: 'Ошибка получения eSIM' }, { status: 500 })
  }
}
