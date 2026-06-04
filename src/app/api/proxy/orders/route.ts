import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/proxy/orders — купленные прокси текущего пользователя (status paid).
 *
 * Авторизация по сессии, данные через service-role с жёстким .eq('user_id', user.id).
 * Используется в профиле/заказах: показ ip:port:user:pass, тип, страна, срок.
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
      .from('proxy_orders')
      .select(
        'id, version, country, count, period, proxy_type, price_internal, proxies, status, created_at',
        { count: 'exact' }
      )
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[proxy/orders] list error:', error)
      return NextResponse.json({ error: 'Не удалось загрузить прокси' }, { status: 500 })
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
    console.error('[proxy/orders] unexpected error:', error)
    return NextResponse.json({ error: 'Ошибка получения прокси' }, { status: 500 })
  }
}
