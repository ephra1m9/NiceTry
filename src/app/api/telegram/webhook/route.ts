import { NextRequest, NextResponse } from 'next/server'
import { WEBHOOK_SECRET, isConfigured } from '@/lib/telegram/config'
import { processUpdate, type TgUpdate } from '@/lib/telegram/bot'

export const dynamic = 'force-dynamic'

/**
 * POST /api/telegram/webhook
 *
 * Точка приёма апдейтов Telegram (предпочтительный для Vercel вариант — webhook, не polling).
 *
 * БЕЗОПАСНОСТЬ: Telegram присылает заголовок X-Telegram-Bot-Api-Secret-Token, равный секрету,
 * заданному при setWebhook. Сверяем его — так посторонний, узнавший URL, не сможет слать
 * фальшивые апдейты. Несовпадение → 401.
 *
 * НАДЁЖНОСТЬ: всегда отвечаем 200 после постановки в обработку — иначе Telegram будет
 * повторять апдейт. Обработчики идемпотентны и сами гасят свои ошибки (см. processUpdate).
 */
export async function POST(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Bot is not configured' }, { status: 503 })
  }

  const secret = request.headers.get('x-telegram-bot-api-secret-token')
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 401 })
  }

  let update: TgUpdate
  try {
    update = (await request.json()) as TgUpdate
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  await processUpdate(update)
  return NextResponse.json({ ok: true })
}
