import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { validateNickname } from '@/lib/auth/nickname'

// POST /api/user/nickname — установить ник текущему пользователю (после регистрации/входа).
// Тело: { nickname }.
//
// Требует сессии. Профиль создаётся, если его ещё нет (первый вход). Уникальность ника гарантирует
// частичный UNIQUE-индекс LOWER(nickname) в БД — гонку ловим по коду 23505.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const nickname = (body?.nickname ?? '').toString().trim()
    const v = validateNickname(nickname)
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 })
    }

    // Профиль уже есть?
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id, nickname')
      .eq('id', user.id)
      .maybeSingle()

    // Повторная установка ника не разрешается через этот роут (ник постоянный после выбора).
    if (existing?.nickname) {
      return NextResponse.json({ error: 'Ник уже установлен' }, { status: 409 })
    }

    let result
    if (existing) {
      result = await supabaseAdmin
        .from('users')
        .update({ nickname })
        .eq('id', user.id)
        .select('id, nickname, email')
        .single()
    } else {
      // Профиля ещё нет — создаём с ником и реф-кодом (как в /api/user/profile, минимально).
      const referralCode = (() => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        let c = ''
        for (let i = 0; i < 8; i++) c += chars.charAt(Math.floor(Math.random() * chars.length))
        return c
      })()
      const { data: bronze } = await supabaseAdmin
        .from('user_statuses')
        .select('id')
        .eq('name', 'Bronze')
        .maybeSingle()
      result = await supabaseAdmin
        .from('users')
        .insert({
          id: user.id,
          email: user.email!,
          nickname,
          referral_code: referralCode,
          status_id: bronze?.id ?? null,
          balance: 0,
        })
        .select('id, nickname, email')
        .single()
    }

    if (result.error) {
      // Уникальность ника (или реф-кода) — занято.
      if (result.error.code === '23505') {
        return NextResponse.json({ error: 'Этот ник уже занят' }, { status: 409 })
      }
      console.error('set nickname error:', result.error)
      return NextResponse.json({ error: 'Не удалось сохранить ник' }, { status: 500 })
    }

    return NextResponse.json({ success: true, nickname: result.data.nickname })
  } catch (error) {
    console.error('set nickname error:', error)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
