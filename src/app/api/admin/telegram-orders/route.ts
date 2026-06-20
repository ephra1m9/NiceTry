import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

// Админка всегда читает живые заявки — без кэша роута.
export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/admin/telegram-orders — список заявок на Stars/Premium с фильтрами
// (status, поиск по username получателя/email покупателя). Выдача ручная — этот список
// и есть «рабочая очередь» для отправки звёзд/Premium получателю.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    const search = sp.get('search')

    let query = supabase
      .from('telegram_orders')
      .select(`
        id, product_type, amount, recipient_username, price_usd, price_rub, status,
        supplier_order_id, created_at,
        users (email)
      `)
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }
    if (search) {
      // Экранируем спецсимволы PostgREST-фильтра (,()) во избежание инъекции в .or().
      const safe = search.replace(/[,()*]/g, ' ').trim()
      if (safe) query = query.or(`recipient_username.ilike.%${safe}%,users.email.ilike.%${safe}%`)
    }

    const { data: orders, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ orders })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
