import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/banners — активные баннеры для главной (публичный)
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('banners')
      .select('id, title, image_url, link_url')
      .eq('is_active', true)
      .order('sort_order')
    if (error) return NextResponse.json({ banners: [] })
    return NextResponse.json({ banners: data })
  } catch {
    return NextResponse.json({ banners: [] })
  }
}
