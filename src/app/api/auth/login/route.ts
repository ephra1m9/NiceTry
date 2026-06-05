import { NextResponse } from 'next/server'

// УСТАРЕЛО. Раньше здесь был вход по magic-link через Supabase (signInWithOtp), и письмо
// отправлял сам Supabase. Теперь вход — по коду через Resend:
//   POST /api/auth/send-code   { identifier }   — отправить код
//   POST /api/auth/verify-code { identifier, code } — проверить код и войти
// Роут оставлен как заглушка, чтобы случайный вызов НЕ инициировал письмо Supabase.
export async function POST() {
  return NextResponse.json(
    { error: 'Этот способ входа отключён. Используйте вход по коду.' },
    { status: 410 },
  )
}
