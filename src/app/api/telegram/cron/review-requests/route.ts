import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { notifyReviewRequest } from '@/lib/telegram/notify'
import { CRON_SECRET, REVIEW_REQUEST_DELAY_HOURS, isConfigured } from '@/lib/telegram/config'

export const dynamic = 'force-dynamic'

/**
 * GET /api/telegram/cron/review-requests
 *
 * Запрос отзыва спустя время после выдачи (ТЗ §5.8/§5.9). Вызывается по расписанию
 * (Vercel Cron — см. vercel.json) или вручную. Находит заказы, выданные более
 * REVIEW_REQUEST_DELAY_HOURS назад, по которым ещё не просили отзыв, и шлёт запрос.
 *
 * ИДЕМПОТЕНТНОСТЬ без отдельной таблицы: маркер «отзыв запрошен» — строка в существующей
 * таблице reviews (rating=NULL, comment='review_requested'). Перед отправкой проверяем,
 * что для заказа ещё нет НИ маркера, НИ реального отзыва → дублей не будет.
 *
 * БЕЗОПАСНОСТЬ: доступ только с валидным секретом — заголовок Authorization: Bearer <CRON_SECRET>
 * или служебный заголовок Vercel Cron (x-vercel-cron). Иначе 401.
 */
export async function GET(request: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ error: 'Bot is not configured' }, { status: 503 })

  const auth = request.headers.get('authorization') || ''
  const isVercelCron = request.headers.get('x-vercel-cron') !== null
  const authorized = isVercelCron || (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cutoff = new Date(Date.now() - REVIEW_REQUEST_DELAY_HOURS * 3600_000).toISOString()

  // Кандидаты: выданные заказы старше cutoff, у пользователя есть привязка telegram_id.
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, user_id, users!inner(telegram_id)')
    .eq('status', 'delivered')
    .lte('updated_at', cutoff)
    .not('users.telegram_id', 'is', null)
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let requested = 0
  let skipped = 0
  for (const order of orders || []) {
    // Уже есть отзыв или маркер запроса по этому заказу?
    const { data: existing } = await supabaseAdmin
      .from('reviews')
      .select('id')
      .eq('order_id', order.id)
      .limit(1)
      .maybeSingle()
    if (existing) {
      skipped++
      continue
    }

    // Ставим маркер ДО отправки (если упадёт доставка — повторно дёргать не будем; маркер можно
    // снять вручную). Маркер уникализирует запрос на отзыв по заказу.
    const { error: markErr } = await supabaseAdmin.from('reviews').insert({
      user_id: order.user_id,
      order_id: order.id,
      rating: null,
      comment: 'review_requested',
      is_published: false,
    })
    if (markErr) {
      skipped++
      continue
    }

    if (order.user_id) {
      await notifyReviewRequest(order.user_id, { order_number: order.order_number })
      requested++
    }
  }

  return NextResponse.json({ ok: true, requested, skipped, checked: orders?.length || 0 })
}
