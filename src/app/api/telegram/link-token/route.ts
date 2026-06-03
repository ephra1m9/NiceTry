import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSiteLinkToken } from '@/lib/telegram/verify'
import { BOT_USERNAME, isConfigured } from '@/lib/telegram/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/telegram/link-token — выдать одноразовую ссылку привязки Telegram (email-first).
 *
 * Авторизованный пользователь сайта получает deep-link t.me/<bot>?start=<token>, где token —
 * подписанный (HMAC) и кратко живущий (15 мин). При переходе бот привязывает его Telegram
 * к ЭТОМУ аккаунту. Stateless: код в БД не хранится — подделать/переиспользовать нельзя.
 */
export async function POST() {
  if (!isConfigured() || !BOT_USERNAME) {
    return NextResponse.json({ error: 'Бот не сконфигурирован' }, { status: 503 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  }

  const token = createSiteLinkToken(user.id)
  const url = `https://t.me/${BOT_USERNAME}?start=${token}`
  return NextResponse.json({ url, token })
}
