import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// POST /api/auth/dev-login — вход БЕЗ отправки письма (только для локальной разработки).
//
// Зачем: встроенный SMTP Supabase жёстко лимитирован (несколько писем в час) → при отладке
// быстро ловится "email rate limit exceeded". Этот роут через service-role генерирует
// одноразовый token_hash (generateLink почту НЕ шлёт и лимит НЕ трогает) и тут же подтверждает
// его (verifyOtp), создавая сессию в cookies — пользователь сразу залогинен.
//
// Безопасность: доступен всегда в dev-режиме. В production — только при ALLOW_DEV_LOGIN=true
// (обход лимита писем Supabase на бесплатном тарифе; при появлении своего SMTP — убрать).
// Для боевого входа используется обычный magic link (/api/auth/login) + свой SMTP.
export async function POST(request: NextRequest) {
  const isProduction = process.env.NODE_ENV === 'production'
  const devLoginAllowed = process.env.ALLOW_DEV_LOGIN === 'true'

  if (isProduction && !devLoginAllowed) {
    return NextResponse.json({ error: 'Недоступно в production' }, { status: 403 })
  }

  try {
    const { email } = await request.json()

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Некорректный email' }, { status: 400 })
    }

    // 1. Гарантируем существование пользователя (magiclink генерируется только для существующих).
    //    Если уже зарегистрирован — createUser вернёт ошибку, её игнорируем.
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    if (createError && !/registered|already/i.test(createError.message)) {
      console.error('Dev-login createUser error:', createError)
      return NextResponse.json({ error: createError.message }, { status: 400 })
    }

    // 2. Генерируем одноразовый token_hash (без отправки письма).
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('Dev-login generateLink error:', linkError)
      return NextResponse.json(
        { error: linkError?.message || 'Не удалось сгенерировать токен' },
        { status: 400 }
      )
    }

    // 3. Подтверждаем token_hash серверным клиентом → сессия пишется в cookies.
    const supabase = await createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: 'magiclink',
      token_hash: linkData.properties.hashed_token,
    })
    if (verifyError) {
      console.error('Dev-login verifyOtp error:', verifyError)
      return NextResponse.json({ error: verifyError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Dev-login error:', error)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
