// Выдача моментального товара — ЕДИНЫЙ источник истины для всех путей оплаты.
//
// Используется и в /api/orders/create (оплата с баланса), и в live-вебхуке pay4game
// (src/lib/payments/fulfillment.ts). Маршрутизирует выдачу по поставщику:
//   • AppRoute (shop) — создать заказ → дождаться терминального статуса → раскрыть коды;
//   • Dessly (gift)   — отправить игру гифтом по invite-ссылке Steam (нужен formData);
//   • локальные ключи — выдать из product_keys (is_used=false → used).
//
// Раньше эта логика жила приватно в /api/orders/create, а live-вебхук выдавал заглушку —
// из-за чего AppRoute/Dessly-товары при оплате через pay4game не доезжали до покупателя.

import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  createShopOrder,
  waitForOrder,
  unhideVouchers,
  AppRouteError,
  AppRouteStatusCode,
} from '@/lib/approute'
import {
  sendGift,
  resolvePackage,
  getTransactionStatus,
  isSteamInviteUrl,
  DesslyError,
  createEsimOrder,
  getEsimOrderStatus,
} from '@/lib/dessly'
import type { Product } from '@/types'

/**
 * Поставщик ПРИНЯЛ заказ, но выдача ещё не завершена (Dessly: paid/executing/pending).
 * Это не провал — деньги у поставщика не возвращаются, позиция остаётся «в обработке».
 * Несёт transactionId, чтобы записать его в заказ для последующего опроса/сверки.
 */
export class DeliveryPendingError extends Error {
  constructor(public transactionId: string) {
    super('delivery_pending')
    this.name = 'DeliveryPendingError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Кол-во опросов статуса выдачи Dessly при создании заказа (backoff 1.5–3с → ~30с суммарно).
// Вынесено в константу, чтобы тест мог переопределить через env и не ждать реальные 30с.
const DESSLY_POLL_MAX_TRIES = Number(process.env.DESSLY_POLL_MAX_TRIES) || 12

/** Выдача моментального товара: AppRoute (shop), Dessly (gift) или локальные ключи из файла. */
export async function deliverInstant(
  product: Product,
  quantity: number,
  referenceId: string,
  formData?: Record<string, string>
): Promise<string[]> {
  // AppRoute shop: создать заказ → дождаться терминального статуса → unhide.
  if (product.supplier === 'approute' && product.denomination_id) {
    const created = await createShopOrder(referenceId, product.denomination_id, quantity)
    const orderId = created.data?.orderId
    // Polling до терминального статуса (SUCCESS / PARTIALLY_COMPLETED / CANCELLED).
    const settled = await waitForOrder({ orderId, referenceId })
    // CANCELLED у поставщика → выдачи не будет, явно сигналим провал (→ возврат на баланс).
    if (settled?.status === 'CANCELLED') {
      throw new AppRouteError('Order cancelled by provider', AppRouteStatusCode.UPSTREAM_ERROR, 200, created.traceId)
    }
    // SUCCESS или PARTIALLY_COMPLETED: раскрываем доступные коды (при partial вернётся то, что есть).
    const codes = await unhideVouchers({ orderId, referenceId })
    if (codes.length) return codes
    throw new AppRouteError('Voucher not available yet', AppRouteStatusCode.UPSTREAM_ERROR, 0, created.traceId)
  }

  // Dessly: отправка игры гифтом по ссылке-приглашению Steam.
  // ID игры (app_id) у Dessly хранится в denomination_id (БД-каталог) / supplier_id (фолбэк-каталог).
  const desslyGameId = product.supplier_id || product.denomination_id || product.supplier_service_id
  if (product.supplier === 'dessly' && desslyGameId) {
    // invite_url принимаем под ключом recipient (исторически) или invite_url/account_reference.
    const inviteUrl = (formData?.recipient || formData?.invite_url || formData?.account_reference || '').trim()
    const region = (formData?.region || 'RU').toUpperCase()
    const editionName = formData?.edition || undefined
    // Валидация ссылки ДО обращения к поставщику: невалидный invite → провал → возврат на баланс.
    if (!isSteamInviteUrl(inviteUrl)) {
      throw new DesslyError('Некорректная ссылка-приглашение Steam', 400)
    }

    // package_id: из формы (если фронт уже выбрал издание) либо резолвим по app_id+регион+издание.
    let packageId = formData?.package_id ? Number(formData.package_id) : NaN
    if (!Number.isFinite(packageId) || packageId <= 0) {
      const pkg = await resolvePackage(desslyGameId, region, editionName)
      if (!pkg) {
        throw new DesslyError('Издание/регион недоступны для отправки гифта', 400, -58)
      }
      packageId = pkg.packageId
    }

    let res = await sendGift({ inviteUrl, packageId, region, reference: referenceId })
    const transactionId = res.transactionId
    // Отслеживание статуса: если гифт ещё в обработке — опрашиваем С ПАУЗОЙ до терминального
    // исхода. Без паузы 10 опросов укладывались в <1с, статус оставался pending → заказ ложно
    // помечался failed, хотя Dessly доводит выдачу через несколько секунд (paid→executing→completed).
    // Backoff 1.5–3с, общий бюджет ~30с (укладывается в maxDuration=60). Если по истечении
    // статус всё ещё pending — НЕ провал: уходим в DeliveryPendingError, дозабор делает cron.
    let tries = 0
    while (res.status === 'pending' && transactionId && tries < DESSLY_POLL_MAX_TRIES) {
      await sleep(Math.min(1500 + tries * 500, 3000))
      tries += 1
      res = await getTransactionStatus(transactionId)
    }
    if (res.status === 'failed') {
      throw new DesslyError(res.message || 'Отправка гифта не удалась', 502, res.errorCode)
    }
    if (res.status === 'pending') {
      // Dessly ПРИНЯЛ заказ (есть order_id), но выдача ещё идёт. Это НЕ провал: деньги у
      // поставщика не возвращаются, поэтому и покупателю возврат делать нельзя. Сигналим
      // «в обработке» — позиция станет pending, заказ останется в работе (paid).
      if (!transactionId) {
        throw new DesslyError(res.message || 'Поставщик не принял заказ', 502, res.errorCode)
      }
      throw new DeliveryPendingError(transactionId)
    }
    return [res.giftLink || `Гифт отправлен: транзакция ${transactionId}`]
  }

  // Локальные ключи (тип 1а — из файла).
  const out: string[] = []
  for (let i = 0; i < quantity; i++) {
    const { data: key } = await supabaseAdmin
      .from('product_keys')
      .select('*')
      .eq('product_id', product.id)
      .eq('is_used', false)
      .limit(1)
      .maybeSingle()
    if (!key) break
    const { error } = await supabaseAdmin
      .from('product_keys')
      .update({ is_used: true, used_at: new Date().toISOString() })
      .eq('id', key.id)
      .eq('is_used', false) // защита от гонки
    if (!error) out.push(key.key_value)
  }
  return out
}

/**
 * Покупка eSIM через Dessly (см. lib/dessly.ts createEsimOrder/getEsimOrderStatus). Используется
 * И из /api/dessly/esim/order (оплата с баланса), И из вебхука pay4game (оплата картой) — там
 * order_items.product_id всегда null (eSIM не лежит в каталоге, цена динамическая), поэтому
 * выдача роутится по form_data.type==='esim', а не по supplier товара (см. fulfillment.ts).
 *
 * Семантика поллинга/таймаута зеркалит deliverInstant (steam_gift) выше: backoff 1.5–3с,
 * бюджет ~30с, pending по истечении → DeliveryPendingError (деньги у поставщика, не провал).
 */
export async function deliverEsim(variantId: string, productId: string, referenceId: string): Promise<string[]> {
  let res = await createEsimOrder({ variantId, productId, reference: referenceId })
  const transactionId = res.transactionId
  let status = res.status
  let tries = 0
  let full = await getEsimOrderStatus(transactionId)
  while (full.status === 'pending' && transactionId && tries < DESSLY_POLL_MAX_TRIES) {
    await sleep(Math.min(1500 + tries * 500, 3000))
    tries += 1
    full = await getEsimOrderStatus(transactionId)
  }
  status = full.status

  if (status === 'failed') {
    throw new DesslyError(full.message || 'Покупка eSIM не удалась', 502, full.errorCode)
  }
  if (status === 'pending') {
    if (!transactionId) {
      throw new DesslyError(full.message || 'Поставщик не принял заказ', 502, full.errorCode)
    }
    throw new DeliveryPendingError(transactionId)
  }

  const lines: string[] = []
  if (full.qrCodeText) lines.push(`QR-код активации: ${full.qrCodeText}`)
  if (full.smdpAddress) lines.push(`SM-DP+ адрес: ${full.smdpAddress}`)
  if (full.matchingId) lines.push(`Matching ID: ${full.matchingId}`)
  if (full.iccid) lines.push(`ICCID: ${full.iccid}`)
  if (full.universalLink) lines.push(`Ссылка для установки: ${full.universalLink}`)
  if (full.androidUniversalLink) lines.push(`Ссылка для установки (Android): ${full.androidUniversalLink}`)
  return lines.length ? lines : [`eSIM активирована: транзакция ${transactionId}`]
}
