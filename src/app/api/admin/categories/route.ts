import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ categories: categories || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const body = await request.json().catch(() => null)
    if (!body || !body.name) {
      return NextResponse.json({ error: 'Поле name обязательно' }, { status: 400 })
    }

    const slug = body.slug || body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    const payload = {
      name: String(body.name),
      slug,
      icon: body.icon ? String(body.icon) : null,
      markup_percent: body.markup_percent !== undefined ? Number(body.markup_percent) : 14,
      usd_to_rub_rate: body.usd_to_rub_rate !== undefined ? Number(body.usd_to_rub_rate) : 80,
      supplier: body.supplier || null,
      is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
      sort_order: body.sort_order !== undefined ? Number(body.sort_order) : 0,
      regions: Array.isArray(body.regions) ? body.regions : [],
    }

    const { data: category, error } = await supabase
      .from('categories')
      .insert(payload)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ category }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
