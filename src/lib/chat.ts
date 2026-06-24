// Чат по заказу (покупатель ↔ продавец) — серверные хелперы, всегда через service-role.
//
// Один чат на заказ (order_chats.order_id UNIQUE), создаётся лениво в момент первой оплаты
// (см. хуки в src/lib/payments/fulfillment.ts, src/app/api/orders/create/route.ts,
// src/app/api/dessly/cron/reconcile/route.ts). Авто-выданные позиции попадают в чат системным
// сообщением; позиции без авто-выдачи закрывает админ обычным текстом через postMessage.

import { supabaseAdmin } from '@/lib/supabase/admin'

export type ChatSenderType = 'user' | 'admin' | 'system'

export interface OrderChat {
  id: string
  order_id: string
  user_id: string | null
  status: 'open' | 'closed'
  last_message_at: string
  last_sender_type: ChatSenderType | null
  created_at: string
}

export interface ChatMessage {
  id: string
  chat_id: string
  sender_type: ChatSenderType
  sender_id: string | null
  body: string
  created_at: string
}

export async function getChatByOrder(orderId: string): Promise<OrderChat | null> {
  const { data } = await supabaseAdmin.from('order_chats').select('*').eq('order_id', orderId).maybeSingle()
  return (data as OrderChat | null) ?? null
}

/** Идемпотентно: повторный вызов для уже существующего заказа вернёт тот же чат, created=false. */
export async function getOrCreateChat(
  orderId: string,
  userId: string | null
): Promise<{ chat: OrderChat; created: boolean }> {
  const existing = await getChatByOrder(orderId)
  if (existing) return { chat: existing, created: false }

  const { data, error } = await supabaseAdmin
    .from('order_chats')
    .insert({ order_id: orderId, user_id: userId })
    .select()
    .single()

  if (error || !data) {
    // Гонка (параллельный вебхук/запрос создал чат между select и insert) — UNIQUE(order_id)
    // отбивает наш insert, читаем то, что уже создано.
    const raced = await getChatByOrder(orderId)
    if (raced) return { chat: raced, created: false }
    throw new Error(`[chat] не удалось создать чат для заказа ${orderId}: ${error?.message}`)
  }
  return { chat: data as OrderChat, created: true }
}

export async function listMessages(chatId: string): Promise<ChatMessage[]> {
  const { data } = await supabaseAdmin
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
  return (data as ChatMessage[]) ?? []
}

export async function postMessage(
  chatId: string,
  senderType: ChatSenderType,
  senderId: string | null,
  body: string
): Promise<ChatMessage> {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .insert({ chat_id: chatId, sender_type: senderType, sender_id: senderId, body })
    .select()
    .single()
  if (error || !data) throw new Error(`[chat] не удалось отправить сообщение: ${error?.message}`)

  await supabaseAdmin
    .from('order_chats')
    .update({ last_message_at: data.created_at, last_sender_type: senderType })
    .eq('id', chatId)

  return data as ChatMessage
}

export function postSystemMessage(chatId: string, body: string): Promise<ChatMessage> {
  return postMessage(chatId, 'system', null, body)
}

/** Продавец закрывает чат: покупатель сохраняет доступ к истории, но больше не может писать. */
export async function closeChat(chatId: string, reason: string): Promise<void> {
  const { error } = await supabaseAdmin.from('order_chats').update({ status: 'closed' }).eq('id', chatId)
  if (error) throw new Error(`[chat] не удалось закрыть чат ${chatId}: ${error.message}`)
  await postSystemMessage(chatId, `🔒 Продавец закрыл чат.\nПричина: ${reason}`)
}

// --- Best-effort варианты для хуков выдачи (вебхук/cron/оформление заказа) -----------------
// Чат — побочный канал уведомления покупателя, а не часть денежного потока. Сбой здесь (БД
// недоступна, гонка и т.п.) НЕ должен ронять выдачу/возврат — логируем и проглатываем, как
// уже сделано для notifyUser в src/lib/telegram/notify.ts. Для прямых API-роутов чата
// (см. /api/orders/[id]/chat) используются throw-варианты выше — там ошибка обязана дойти
// до клиента как 500.

export async function safeGetOrCreateChat(
  orderId: string,
  userId: string | null
): Promise<{ chat: OrderChat; created: boolean } | null> {
  try {
    return await getOrCreateChat(orderId, userId)
  } catch (e) {
    console.error('[chat] getOrCreateChat (best-effort) failed:', e)
    return null
  }
}

export async function safePostSystemMessage(chatId: string, body: string): Promise<void> {
  try {
    await postSystemMessage(chatId, body)
  } catch (e) {
    console.error('[chat] postSystemMessage (best-effort) failed:', e)
  }
}

export interface AdminChatRow {
  id: string
  order_id: string
  status: 'open' | 'closed'
  last_message_at: string
  last_sender_type: ChatSenderType | null
  order_number: string
  order_status: string
  user_email: string | null
  user_telegram_username: string | null
  needs_attention: boolean
}

export async function listChatsForAdmin(
  { page = 1, limit = 20 }: { page?: number; limit?: number } = {}
): Promise<{ chats: AdminChatRow[]; total: number }> {
  const from = (page - 1) * limit
  const to = from + limit - 1

  const { data: chats, error, count } = await supabaseAdmin
    .from('order_chats')
    .select(
      `id, order_id, status, last_message_at, last_sender_type,
       orders!inner(order_number, status),
       users(email, telegram_username)`,
      { count: 'exact' }
    )
    .order('last_message_at', { ascending: false })
    .range(from, to)

  if (error || !chats) return { chats: [], total: 0 }

  const orderIds = chats.map((c: any) => c.order_id)
  const attentionSet = await ordersNeedingAttention(orderIds)

  const rows: AdminChatRow[] = chats.map((c: any) => ({
    id: c.id,
    order_id: c.order_id,
    status: c.status,
    last_message_at: c.last_message_at,
    last_sender_type: c.last_sender_type,
    order_number: c.orders?.order_number || '',
    order_status: c.orders?.status || '',
    user_email: c.users?.email || null,
    user_telegram_username: c.users?.telegram_username || null,
    needs_attention: attentionSet.has(c.order_id),
  }))

  // needs_attention поднимаем наверх внутри уже загруженной страницы (страницы малы,
  // полноценная сортировка по двум критериям на стороне БД для MVP избыточна).
  rows.sort((a, b) => {
    if (a.needs_attention !== b.needs_attention) return a.needs_attention ? -1 : 1
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  })

  return { chats: rows, total: count || 0 }
}

/**
 * Заказы из переданного списка, у которых есть pending-позиция, НЕ способная довыдаться
 * автоматикой (instant добивается deliverInstant/dessly-cron, всё остальное — только руками
 * админа: topup_auto без авто-выдачи, topup_manual, manual, позиции без product_id).
 */
async function ordersNeedingAttention(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set()
  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('order_id, product_id, products(type)')
    .in('order_id', orderIds)
    .eq('delivery_status', 'pending')

  const set = new Set<string>()
  for (const it of items || []) {
    const productType = (it as any).products?.type
    if (!it.product_id || productType !== 'instant') set.add(it.order_id as string)
  }
  return set
}
