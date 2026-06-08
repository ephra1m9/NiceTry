// Доступ к таблицам payments / payment_webhooks (только service-role).
// Используется live-потоком pay4game: создание платежа, лог/идемпотентность вебхуков,
// обновление статусов и поиск заказа по invoice_id (= orders.supplier_reference_id).

import { supabaseAdmin } from '@/lib/supabase/admin'

export interface PaymentRow {
  id: string
  invoice_id: string
  uuid: string | null
  method: string | null
  amount: number
  status: string
  hold: number
  email: string | null
  /** Ссылка на хостовую страницу оплаты pay4game (ответ payment/create). */
  url: string | null
  qr_content: string | null
  qr_img: string | null
  agent_transaction_id: string | null
  steam_account: string | null
  steam_amount: number | null
  steam_status: string | null
  payout_status: string | null
}

/** Создать (или обновить, если повтор) строку платежа при создании платежа в pay4game. */
export async function upsertPaymentOnCreate(row: {
  invoice_id: string
  uuid: string | null
  method: string
  amount: number
  email: string
  url?: string | null
  agent_transaction_id?: string | null
  steam_account?: string | null
  steam_amount?: number | null
}): Promise<void> {
  const base = {
    invoice_id: row.invoice_id,
    uuid: row.uuid,
    method: row.method,
    amount: row.amount,
    email: row.email,
    status: 'pending',
    hold: 0,
    agent_transaction_id: row.agent_transaction_id ?? null,
    steam_account: row.steam_account ?? null,
    steam_amount: row.steam_amount ?? null,
  }
  // Сначала пытаемся со ссылкой на оплату (колонка url). Если её ещё нет в БД (рассинхрон
  // деплоя и миграции 2026-06-08_payments_url.sql) — повторяем без неё, платёж всё равно сохранится.
  let { error } = await supabaseAdmin
    .from('payments')
    .upsert({ ...base, url: row.url ?? null }, { onConflict: 'invoice_id' })
  if (error) {
    console.warn('[payments/db] upsert с url упал, повтор без url:', error.message)
    ;({ error } = await supabaseAdmin.from('payments').upsert(base, { onConflict: 'invoice_id' }))
  }
  if (error) {
    console.error('[payments/db] upsertPaymentOnCreate failed:', error)
    throw new Error('Не удалось сохранить платёж')
  }
}

/** Платёж по invoice_id (для страницы оплаты/статуса). */
export async function getPaymentByInvoice(invoiceId: string): Promise<PaymentRow | null> {
  const { data } = await supabaseAdmin.from('payments').select('*').eq('invoice_id', invoiceId).maybeSingle()
  return (data as PaymentRow) ?? null
}

/** Частичное обновление платежа по invoice_id. */
export async function updatePayment(invoiceId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from('payments').update(patch).eq('invoice_id', invoiceId)
  if (error) {
    console.error('[payments/db] updatePayment failed:', error)
    throw new Error('Не удалось обновить платёж')
  }
}

/**
 * Записать вебхук в лог с идемпотентностью по (type, invoice_id, status).
 * Возвращает:
 *   alreadyProcessed=true — точно такой вебхук уже УСПЕШНО обработан → можно пропустить (200).
 *   alreadyProcessed=false — либо первый раз, либо прошлый раз обработка не доехала (processed=false)
 *     → обработчик должен выполниться (идемпотентно) и затем вызвать markWebhookProcessed.
 * При ошибках БД (кроме дубля) — кидает: вызывающий вернёт 5xx и получит ретрай pay4game.
 */
export async function recordWebhook(args: {
  type: string
  invoiceId: string | null
  status: string | null
  signature: string | null
  body: unknown
}): Promise<{ alreadyProcessed: boolean }> {
  const { error } = await supabaseAdmin.from('payment_webhooks').insert({
    type: args.type,
    // Нормализуем к '' (как COALESCE в UNIQUE-индексе) — чтобы markWebhookProcessed находил строку.
    invoice_id: args.invoiceId ?? '',
    status: args.status ?? '',
    signature: args.signature,
    body: args.body as object,
    processed: false,
  })
  if (!error) return { alreadyProcessed: false }
  if ((error as { code?: string }).code === '23505') {
    // Уже видели этот вебхук. Обработан ли он до конца?
    const { data } = await supabaseAdmin
      .from('payment_webhooks')
      .select('processed')
      .eq('type', args.type)
      .eq('invoice_id', args.invoiceId ?? '')
      .eq('status', args.status ?? '')
      .maybeSingle()
    return { alreadyProcessed: !!data?.processed }
  }
  console.error('[payments/db] recordWebhook insert failed:', error)
  throw new Error('webhook log failed')
}

/** Пометить лог-запись вебхука обработанной. */
export async function markWebhookProcessed(args: {
  type: string
  invoiceId: string | null
  status: string | null
}): Promise<void> {
  await supabaseAdmin
    .from('payment_webhooks')
    .update({ processed: true })
    .eq('type', args.type)
    .eq('invoice_id', args.invoiceId ?? '')
    .eq('status', args.status ?? '')
}
