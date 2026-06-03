import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyTgClaimCode } from '@/lib/telegram/verify'
import { linkTelegramToUser } from '@/lib/telegram/account'
import { isConfigured } from '@/lib/telegram/config'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Барьер от перебора кодов привязки: коды HMAC-подписаны (подделать нельзя), но ограничиваем
// частоту попыток на аккаунт — на случай автоматизированного спама роута.
const CLAIM_LIMIT = 20
const CLAIM_WINDOW_MS = 60_000

/**
 * POST /api/telegram/claim — привязать Telegram к текущему аккаунту по коду из бота.
 *
 * Тело: { code } — подписанный код, который бот выдаёт по кнопке «Код привязки».
 * Используется, когда пользователь сперва зашёл на сайт по email, а затем хочет
 * подключить свой Telegram. Конфликт привязки запрещён и сопровождается предупреждением (ТЗ §5.2).
 */
export async function POST(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Бот не сконфигурирован' }, { status: 503 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const rl = rateLimit(`tg-claim:${user.id}`, CLAIM_LIMIT, CLAIM_WINDOW_MS)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Слишком много попыток, попробуйте позже' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  const body = await request.json().catch(() => null)
  const code: unknown = body?.code
  if (typeof code !== 'string' || !code.trim()) {
    return NextResponse.json({ error: 'Код не указан' }, { status: 400 })
  }

  const verified = verifyTgClaimCode(code)
  if (!verified.ok) {
    const msg = verified.reason === 'expired' ? 'Код привязки истёк' : 'Код привязки недействителен'
    return NextResponse.json({ error: msg, reason: verified.reason }, { status: 400 })
  }

  try {
    const res = await linkTelegramToUser(user.id, { id: verified.telegramId })
    if (res.ok) {
      return NextResponse.json({ success: true, merged: res.merged, telegram_id: verified.telegramId })
    }
    if (res.reason === 'conflict') {
      return NextResponse.json(
        { error: 'Этот Telegram уже привязан к другому аккаунту' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Аккаунт не найден' }, { status: 404 })
  } catch (e) {
    console.error('[telegram/claim] error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Не удалось привязать Telegram' }, { status: 500 })
  }
}
