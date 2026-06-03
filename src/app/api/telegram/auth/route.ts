import { NextRequest, NextResponse } from 'next/server'
import { verifyInitData } from '@/lib/telegram/verify'
import { ensureTelegramUser } from '@/lib/telegram/account'
import { issueSessionForEmail } from '@/lib/telegram/session'
import { isConfigured } from '@/lib/telegram/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/telegram/auth — авто-авторизация в Mini App.
 *
 * Тело: { initData: string } — строка Telegram.WebApp.initData (НЕ initDataUnsafe!).
 *
 * БЕЗОПАСНОСТЬ: подлинность пользователя подтверждается ТОЛЬКО проверкой HMAC-подписи initData
 * на сервере (verifyInitData). Данные из initDataUnsafe/клиента не используются для решения «кто это».
 * После проверки — находим/создаём единый аккаунт по telegram_id и выдаём сессию (cookies).
 */
export async function POST(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Bot is not configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  const initData: unknown = body?.initData
  if (typeof initData !== 'string' || !initData) {
    return NextResponse.json({ error: 'initData отсутствует' }, { status: 400 })
  }

  const verified = verifyInitData(initData)
  if (!verified.ok || !verified.user) {
    const status = verified.reason === 'expired' ? 401 : 403
    return NextResponse.json({ error: 'Подпись initData недействительна', reason: verified.reason }, { status })
  }

  try {
    const profile = await ensureTelegramUser(verified.user)
    const session = await issueSessionForEmail(profile.email)
    if (!session.ok) {
      // Детали ошибки (Supabase) — только в лог, клиенту — обобщённо.
      console.error('[telegram/auth] issueSession:', session.error)
      return NextResponse.json({ error: 'Не удалось выдать сессию' }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      user: {
        id: profile.id,
        telegram_id: profile.telegram_id,
        telegram_username: profile.telegram_username,
      },
    })
  } catch (e) {
    console.error('[telegram/auth] error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Не удалось авторизовать' }, { status: 500 })
  }
}
