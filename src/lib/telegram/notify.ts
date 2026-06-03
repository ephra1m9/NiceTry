// Уведомления через бота (ТЗ §5.8).
//
// Обязательны: «товар выдан» и «запрос отзыва». Опциональны: «принят»/«оплачен».
// Идемпотентность обеспечивается ВЫЗЫВАЮЩИМ кодом через атомарные переходы статусов заказа
// (уведомление шлётся ровно в момент перехода — например, при флипе в delivered/cancelled),
// поэтому повторные webhook/PATCH не порождают дублей.
//
// Принцип «не ломать основной поток»: ошибки доставки (бот заблокирован, таймаут, нет привязки)
// логируются и проглатываются — продажа/возврат не должны падать из-за недоступности Telegram.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendMessage, TelegramApiError, type InlineButton } from './client'
import { isConfigured, WEBAPP_URL, REVIEWS_URL } from './config'
import { formatRub } from '@/lib/utils'

async function telegramIdOf(userId: string): Promise<number | null> {
  const { data } = await supabaseAdmin.from('users').select('telegram_id').eq('id', userId).maybeSingle()
  const id = data?.telegram_id
  return id ? Number(id) : null
}

/** Базовая безопасная отправка пользователю по его user_id. Возвращает статус, не бросает. */
export async function notifyUser(
  userId: string,
  text: string,
  opts: { buttons?: InlineButton[][] } = {}
): Promise<{ sent: boolean; reason?: 'not_configured' | 'not_linked' | 'blocked' | 'error' }> {
  if (!isConfigured()) return { sent: false, reason: 'not_configured' }
  const chatId = await telegramIdOf(userId)
  if (!chatId) return { sent: false, reason: 'not_linked' }
  try {
    await sendMessage(chatId, text, opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {})
    return { sent: true }
  } catch (e) {
    if (e instanceof TelegramApiError && e.isBlocked) {
      console.warn(`[telegram] уведомление не доставлено (бот заблокирован/чат недоступен), user=${userId}`)
      return { sent: false, reason: 'blocked' }
    }
    console.error('[telegram] ошибка доставки уведомления:', e instanceof Error ? e.message : e)
    return { sent: false, reason: 'error' }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const openShopButton: InlineButton[][] = [[{ text: '🛍 Открыть магазин', web_app: { url: WEBAPP_URL } }]]

/** «Товар выдан» — моментально сразу, ручной — при закрытии менеджером (ТЗ §5.8). */
export async function notifyOrderDelivered(
  userId: string,
  order: { order_number: string },
  items: Array<{ product_name: string; voucher_code?: string | null }>
) {
  const lines = [`✅ <b>Заказ ${escapeHtml(order.order_number)} выдан</b>`, '']
  for (const it of items) {
    lines.push(`📦 ${escapeHtml(it.product_name)}`)
    if (it.voucher_code) {
      for (const code of String(it.voucher_code).split('\n').filter(Boolean)) {
        lines.push(`🔑 <code>${escapeHtml(code)}</code>`)
      }
    }
  }
  lines.push('', 'Спасибо за покупку в NiceTry!')
  return notifyUser(userId, lines.join('\n'), { buttons: openShopButton })
}

/** Запрос отзыва спустя время после выдачи (ТЗ §5.8/§5.9). */
export async function notifyReviewRequest(userId: string, order: { order_number: string }) {
  const text = [
    `⭐️ <b>Как вам заказ ${escapeHtml(order.order_number)}?</b>`,
    '',
    'Будем благодарны за отзыв — это помогает другим покупателям и развивает магазин.',
  ].join('\n')
  return notifyUser(userId, text, { buttons: [[{ text: '✍️ Оставить отзыв', url: REVIEWS_URL }]] })
}

/** Пополнение внутреннего баланса. */
export async function notifyBalanceTopup(userId: string, amount: number, newBalance: number) {
  const text = [
    `💰 <b>Баланс пополнен на ${formatRub(amount)}</b>`,
    '',
    `Текущий баланс: <b>${formatRub(newBalance)}</b>`,
  ].join('\n')
  return notifyUser(userId, text, { buttons: openShopButton })
}

/** Возврат средств на внутренний баланс (ТЗ §8.1). */
export async function notifyRefund(
  userId: string,
  order: { order_number: string },
  amount: number
) {
  const text = [
    `↩️ <b>Возврат по заказу ${escapeHtml(order.order_number)}</b>`,
    '',
    `На баланс возвращено <b>${formatRub(amount)}</b>.`,
  ].join('\n')
  return notifyUser(userId, text, { buttons: openShopButton })
}
