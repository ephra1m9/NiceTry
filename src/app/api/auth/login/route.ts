import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Определяет URL сайта для редиректов авторизации.
 *  Приоритет: env NEXT_PUBLIC_SITE_URL (если не localhost), затем заголовок origin/x-forwarded-host от Vercel,
 *  затем фолбэк на NEXT_PUBLIC_SITE_URL (даже если localhost — для локальной разработки). */
function siteOrigin(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  // Если в env явно задан продакшен-URL (не localhost) — используем его.
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl.replace(/\/+$/, '')
  }
  // На Vercel x-forwarded-proto + x-forwarded-host дают реальный домен деплоя.
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    return `${proto}://${host}`
  }
  // Локальная разработка — фолбэк на env (или localhost).
  return envUrl.replace(/\/+$/, '') || `http://${host || 'localhost:3000'}`
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Некорректный email' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const redirectTo = `${siteOrigin(request)}/api/auth/callback`
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    })

    if (error) {
      console.error('Login error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      message: 'Проверьте почту — мы отправили ссылку для входа'
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Ошибка сервера' },
      { status: 500 }
    )
  }
}
