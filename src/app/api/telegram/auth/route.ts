import { NextRequest, NextResponse } from 'next/server'
import { verifyInitData } from '@/lib/telegram/verify'
import { ensureTelegramUser } from '@/lib/telegram/account'
import { issueSessionForEmail } from '@/lib/telegram/session'
import { isConfigured } from '@/lib/telegram/config'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Лимиты флуда: грубый барьер по IP (против спама невалидным initData) и точный
// по проверенному telegram_id (против выжигания лимитов Supabase на генерацию сессий).
const IP_LIMIT = 30 // запросов
const ID_LIMIT = 10 // выдач сессии
const WINDOW_MS = 60_000 // в минуту

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Слишком много запросов, попробуйте позже' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  )
}

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

  // Грубый барьер по IP — до любой работы (отбивает спам мусорным initData).
  const ipRl = rateLimit(`tg-auth:ip:${clientIp(request.headers)}`, IP_LIMIT, WINDOW_MS)
  if (!ipRl.ok) return tooMany(ipRl.retryAfterSec)

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

  // Точный барьер по проверенному telegram_id — ограничивает частоту выдачи сессий/OTP.
  const idRl = rateLimit(`tg-auth:id:${verified.user.id}`, ID_LIMIT, WINDOW_MS)
  if (!idRl.ok) return tooMany(idRl.retryAfterSec)

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
