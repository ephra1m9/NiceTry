import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/telegram/orders — заявки на Telegram Stars/Premium текущего пользователя.
 *
 * Авторизация по сессии, данные через service-role с жёстким .eq('user_id', user.id).
 * Используется в профиле: показ статуса (pending/completed/failed) купленных пакетов.
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
      .from('telegram_orders')
      .select('id, product_type, amount, recipient_username, price_rub, status, created_at', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[telegram/orders] list error:', error)
      return NextResponse.json({ error: 'Не удалось загрузить заявки' }, { status: 500 })
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
    console.error('[telegram/orders] unexpected error:', error)
    return NextResponse.json({ error: 'Ошибка получения заявок' }, { status: 500 })
  }
}
