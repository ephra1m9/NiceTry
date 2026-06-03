import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

// GET /api/admin/utm — статистика UTM-кампаний
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const { data: campaigns, error } = await supabase
      .from('utm_campaigns')
      .select('*, clicks:utm_clicks(count)')
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Посчитать уникальных пользователей и заказы по каждой кампании
    const enriched = await Promise.all((campaigns || []).map(async (c: any) => {
      const { count: users } = await supabase
        .from('utm_clicks')
        .select('user_id', { count: 'exact', head: true })
        .eq('campaign_id', c.id)
      return { ...c, unique_users: users || 0, clicks: c.clicks?.[0]?.count || 0 }
    }))

    return NextResponse.json({ campaigns: enriched })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
