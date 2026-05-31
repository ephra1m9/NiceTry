import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/promo-codes - список промокодов
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Проверка прав администратора
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: promoCodes, error } = await supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ promo_codes: promoCodes })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/admin/promo-codes - создание промокода
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Проверка прав администратора
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    // Проверяем уникальность кода
    const { data: existing } = await supabase
      .from('promo_codes')
      .select('id')
      .eq('code', body.code.toUpperCase())
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Promo code already exists' },
        { status: 400 }
      )
    }

    const { data: promoCode, error } = await supabase
      .from('promo_codes')
      .insert({
        code: body.code.toUpperCase(),
        discount_type: body.discount_type,
        discount_value: body.discount_value,
        max_uses: body.max_uses || null,
        expires_at: body.expires_at || null,
        is_active: body.is_active ?? true,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ promo_code: promoCode }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
