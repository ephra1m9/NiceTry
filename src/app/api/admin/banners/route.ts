import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

// GET /api/admin/banners — все баннеры
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin
    const { data, error } = await supabase.from('banners').select('*').order('sort_order')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ banners: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/admin/banners — создать баннер
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin
    const { title, image_url, link_url, is_active, sort_order } = await request.json()
    if (!title || !image_url) {
      return NextResponse.json({ error: 'title и image_url обязательны' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('banners')
      .insert({ title, image_url, link_url: link_url || null, is_active: is_active ?? true, sort_order: sort_order ?? 0 })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ banner: data }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
