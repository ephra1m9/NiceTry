import { NextRequest, NextResponse } from 'next/server'
import { getPay4gameConfig, verifyWebhookSignature } from '@/lib/payments/pay4game'
import { recordWebhook, markWebhookProcessed, updatePayment } from '@/lib/payments/db'
import { markOrderPaidAndDeliver } from '@/lib/payments/fulfillment'

export const dynamic = 'force-dynamic'

/**
 * POST /api/pay4game/webhook — единая точка приёма вебхуков pay4game.
 *
 * Прописать в панели pay4game «Настройки» → «Уведомления»:
 *   https://www.nicetry.guru/api/pay4game/webhook
 *
 * АЛГОРИТМ (см. WORKLOG_PAY4GAME.md, правила):
 *   1) Прочитать СЫРОЕ тело (req.text()) — до JSON.parse (нужно для проверки подписи).
 *   2) Проверить подпись HMAC-SHA256(raw, SECRET) против X-REQUEST-SIGNATURE (constant-time).
 *      Невалидная подпись → НЕ обрабатываем, 200 (ретраи бесполезны — тело/ключ не изменятся).
 *   3) Идемпотентность: лог в payment_webhooks по (type, invoice_id, status). Уже обработанный → 200.
 *   4) Обработать по type. Временная ошибка БД → 5xx (pay4game повторит). Успех → 200.
 *
 * ВЫДАЧА ЗАКАЗА — только на type='status' при status='success' && hold=0 (см. markOrderPaidAndDeliver).
 */
export async function POST(request: NextRequest) {
  // 1) Сырое тело.
  const raw = await request.text()
  const signature = request.headers.get('x-request-signature')

  // Конфиг/секрет. Если live не сконфигурирован — это серьёзная ошибка окружения: 500 (ретрай).
  let secretKey: string
  try {
    secretKey = getPay4gameConfig().secretKey
  } catch (e) {
    console.error('[pay4game/webhook] config error:', e)
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  // 2) Подпись.
  if (!verifyWebhookSignature(raw, signature, secretKey)) {
    console.warn('[pay4game/webhook] невалидная подпись — игнор')
    // 200, чтобы не ловить бесконечные ретраи на неизменном (битом/чужом) теле.
    return NextResponse.json({ ignored: true }, { status: 200 })
  }

  // Парсинг тела.
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    console.warn('[pay4game/webhook] не JSON-тело — игнор')
    return NextResponse.json({ ignored: true }, { status: 200 })
  }

  const type = String(body.type ?? '')
  const invoiceId = body.invoice_id != null ? String(body.invoice_id) : null
  // status может быть строкой (status/status_steam/status_payoff) или числом (status_topup).
  const statusKey = body.status != null ? String(body.status) : null

  if (!type) {
    return NextResponse.json({ ignored: true }, { status: 200 })
  }

  // 3) Идемпотентность + аудит-лог.
  try {
    const { alreadyProcessed } = await recordWebhook({
      type,
      invoiceId,
      status: statusKey,
      signature,
      body,
    })
    if (alreadyProcessed) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 })
    }
  } catch {
    // Ошибка записи лога — временная, просим ретрай.
    return NextResponse.json({ error: 'log failed' }, { status: 500 })
  }

  // 4) Обработка по типу. Любая ошибка БД → 5xx (ретрай). Успех → пометить processed + 200.
  try {
    switch (type) {
      case 'inform':
        await handleInform(body, invoiceId)
        break
      case 'status':
        await handleStatus(body, invoiceId)
        break
      case 'status_steam':
        await handleStatusSteam(body, invoiceId)
        break
      case 'status_payoff':
        await handleStatusPayoff(body, invoiceId)
        break
      case 'status_topup':
        await handleStatusTopup(body, invoiceId)
        break
      default:
        console.warn('[pay4game/webhook] неизвестный type:', type)
    }
  } catch (e) {
    console.error('[pay4game/webhook] обработка упала, просим ретрай:', e)
    return NextResponse.json({ error: 'processing failed' }, { status: 500 })
  }

  await markWebhookProcessed({ type, invoiceId, status: statusKey }).catch(() => {})
  return NextResponse.json({ ok: true }, { status: 200 })
}

// ——————————————————————————————————————————————————————————————————————
// Обработчики типов
// ——————————————————————————————————————————————————————————————————————

/** inform (sbp+qr): сохранить qr.content/qr.img — страница оплаты покажет их через поллинг. */
async function handleInform(body: Record<string, unknown>, invoiceId: string | null) {
  if (!invoiceId) return
  const qr = (body.qr as { content?: string; img?: string } | undefined) || {}
  await updatePayment(invoiceId, {
    uuid: body.uuid != null ? String(body.uuid) : undefined,
    qr_content: qr.content ?? null,
    qr_img: qr.img ?? null,
    raw_last_webhook: body,
  })
}

/**
 * status: финальный статус платежа. ВЫДАЧА заказа ТОЛЬКО при success && hold=0.
 * hold=1 — успех, но заблокирован для проверки админом → НЕ выдавать, ждать повторный вебхук.
 */
async function handleStatus(body: Record<string, unknown>, invoiceId: string | null) {
  if (!invoiceId) return
  const status = String(body.status ?? '')
  const hold = Number(body.hold ?? 0)
  const uuid = body.uuid != null ? String(body.uuid) : undefined

  await updatePayment(invoiceId, {
    status,
    hold,
    uuid,
    raw_last_webhook: body,
  })

  if (status === 'success' && hold === 0) {
    await markOrderPaidAndDeliver(invoiceId, uuid)
  }
  // hold=1 / pending / declined / refunded — заказ не выдаём. (При declined/refunded заказ
  // остаётся 'new'; можно отдельно отменять — не требуется для текущего потока.)
}

/** status_steam: статус пополнения Steam (ветка payment/create со steam-параметрами). */
async function handleStatusSteam(body: Record<string, unknown>, invoiceId: string | null) {
  if (!invoiceId) return
  await updatePayment(invoiceId, {
    steam_status: body.status != null ? String(body.status) : null,
    agent_transaction_id: body.agent_transaction_id != null ? String(body.agent_transaction_id) : undefined,
    steam_account: body.steam_account != null ? String(body.steam_account) : undefined,
    steam_amount: body.steam_amount != null ? Number(body.steam_amount) : undefined,
    raw_last_webhook: body,
  })
}

/** status_payoff: статус выплаты. */
async function handleStatusPayoff(body: Record<string, unknown>, invoiceId: string | null) {
  if (!invoiceId) return
  await updatePayment(invoiceId, {
    payout_status: body.status != null ? String(body.status) : null,
    raw_last_webhook: body,
  })
}

/** status_topup: статус Steam-пополнения по v2 (check_pay). Ключ — invoice_id, если задан. */
async function handleStatusTopup(body: Record<string, unknown>, invoiceId: string | null) {
  if (!invoiceId) return
  await updatePayment(invoiceId, {
    steam_status: body.status != null ? String(body.status) : null,
    agent_transaction_id: body.agent_transaction_id != null ? String(body.agent_transaction_id) : undefined,
    steam_account: body.account != null ? String(body.account) : undefined,
    raw_last_webhook: body,
  }).catch((e) => {
    // status_topup может прийти по invoice_id, которого нет в payments (чистая v2-проверка) — не падаем.
    console.warn('[pay4game/webhook] status_topup: платёж не найден/не обновлён', invoiceId, e)
  })
}
