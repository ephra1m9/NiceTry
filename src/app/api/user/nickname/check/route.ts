import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { validateNickname } from '@/lib/auth/nickname'

// GET /api/user/nickname/check?nickname=foo — живая проверка «свободен/занят».
//
// Публичный (не требует сессии): нужен на экране выбора ника и в форме входа. Раскрывает только
// факт занятости конкретного ника (нельзя получить список) — приемлемо для UX «ник свободен/занят».
export async function GET(request: NextRequest) {
  const nickname = (request.nextUrl.searchParams.get('nickname') ?? '').trim()

  const v = validateNickname(nickname)
  if (!v.ok) {
    return NextResponse.json({ available: false, valid: false, error: v.error })
  }

  // Регистронезависимый поиск занятости.
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .ilike('nickname', nickname)
    .maybeSingle()

  if (error) {
    console.error('nickname check error:', error)
    return NextResponse.json({ available: false, valid: true, error: 'Ошибка проверки' }, { status: 500 })
  }

  return NextResponse.json({ available: !data, valid: true })
}
