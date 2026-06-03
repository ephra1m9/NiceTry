import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { callTelegram } from '@/lib/telegram/client'

// GET /api/admin/mailings — все рассылки
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin
    const { data, error } = await supabase.from('mailings').select('*').order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ mailings: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/admin/mailings — создать + отправить рассылку
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const { title, message, image_url, button_text, button_url, segment } = await request.json()
    if (!title || !message) {
      return NextResponse.json({ error: 'title и message обязательны' }, { status: 400 })
    }

    // Создаём запись
    const { data: mailing, error } = await supabase
      .from('mailings')
      .insert({ title, message, image_url: image_url || null, button_text: button_text || null, button_url: button_url || null, segment: segment || 'all', status: 'sending' })
      .select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Отправляем в фоне (не держим запрос)
    sendBroadcast(mailing.id, message, image_url, button_text, button_url, segment || 'all').catch(e =>
      console.error('[mailings] broadcast error:', e instanceof Error ? e.message : e)
    )

    return NextResponse.json({ mailing }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

async function sendBroadcast(mailingId: string, text: string, imageUrl?: string, btnText?: string, btnUrl?: string, segment?: string) {
  const { supabaseAdmin } = await import('@/lib/supabase/admin')
  const { callTelegram: callTg } = await import('@/lib/telegram/client')

  // Получаем telegram_id всех пользователей с привязанным Telegram (без сегментации — MVP)
  let query = supabaseAdmin.from('users').select('id, telegram_id').not('telegram_id', 'is', null)
  // TODO: сегментация по segment (with_orders, without_orders, by_status, by_utm)

  let page = 0
  const pageSize = 500
  let sent = 0
  let blocked = 0

  while (true) {
    const { data: users, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1)
    if (error || !users?.length) break

    for (const u of users) {
      if (!u.telegram_id) continue
      try {
        const inlineKeyboard = btnText && btnUrl ? [[{ text: btnText, url: btnUrl }]] : undefined
        if (imageUrl) {
          await callTg('sendPhoto', { chat_id: u.telegram_id, photo: imageUrl, caption: text, ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}) })
        } else {
          await callTg('sendMessage', { chat_id: u.telegram_id, text, ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}) })
        }
        sent++
      } catch (e: any) {
        if (e?.isBlocked) { blocked++; continue }
        // 429 — пауза и ретрай
        if (e?.retryAfter) { await new Promise(r => setTimeout(r, (e.retryAfter + 1) * 1000)); continue }
      }
    }
    page++
    if (users.length < pageSize) break
  }

  await supabaseAdmin.from('mailings').update({ status: 'completed', sent_count: sent }).eq('id', mailingId)
  console.log(`[mailings] рассылка ${mailingId}: отправлено ${sent}, заблокировано ${blocked}`)
}
