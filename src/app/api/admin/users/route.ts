import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/users - список пользователей
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

    // Параметры фильтрации
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search')

    let query = supabase
      .from('users')
      .select(`
        *,
        user_statuses (name, discount_percent)
      `)
      .order('created_at', { ascending: false })

    if (search) {
      query = query.or(`email.ilike.%${search}%,telegram_username.ilike.%${search}%`)
    }

    const { data: users, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ users })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
