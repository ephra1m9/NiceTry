// Pure order-math helpers (no I/O), extracted from /api/orders/create so the money logic
// — line prices, status/promo discounts, final amount, referral bonus — can be unit-tested
// in isolation and reused. Behaviour is identical to the inline logic it replaces.
//
// Pricing of catalog items lives in lib/catalog.ts (priceRub); this module covers the
// per-order arithmetic that runs on top of those prices.

import type { Product, ProductType } from '@/types'

export const TOPUP_TYPES: ProductType[] = ['topup_auto', 'topup_manual']

export function isTopup(type: ProductType): boolean {
  return TOPUP_TYPES.includes(type)
}

/** Discount (₽) granted by the user's status, rounded to whole rubles. */
export function statusDiscount(total: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0
  return Math.round((total * percent) / 100)
}

/** Discount (₽) from a promo code: percentage of total or a fixed amount. */
export function promoDiscount(
  total: number,
  type: 'percent' | 'fixed',
  value: number
): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return type === 'percent'
    ? Math.round((total * value) / 100)
    : Math.round(value)
}

/**
 * Clamp the combined discount to the order total and derive the final amount.
 * The final amount is never negative and never exceeds the total.
 */
export function settleAmounts(
  total: number,
  rawDiscount: number
): { discount: number; final: number } {
  const discount = Math.min(Math.max(0, rawDiscount), total)
  return { discount, final: Math.max(0, total - discount) }
}

export interface PromoLike {
  is_active?: boolean
  expires_at?: string | null
  max_uses?: number | null
  used_count?: number | null
}

/** A promo code is applicable only if active, not expired and not over its usage limit. */
export function isPromoApplicable(promo: PromoLike | null | undefined, now: Date): boolean {
  if (!promo) return false
  if (promo.is_active === false) return false
  if (promo.expires_at && new Date(promo.expires_at) < now) return false
  if (promo.max_uses != null && Number(promo.used_count ?? 0) >= Number(promo.max_uses)) {
    return false
  }
  return true
}

/**
 * Server-side line price (₽). For top-ups the user-entered amount is used (validated against
 * min/max by the caller); for everything else it is the catalog price × quantity.
 * Returns null with a reason when the input is invalid so the caller can reject the order.
 */
export function computeLinePrice(
  product: Pick<Product, 'type' | 'price' | 'min_amount' | 'max_amount'>,
  quantity: number,
  customAmount?: number
): { ok: true; linePrice: number } | { ok: false; error: string } {
  if (isTopup(product.type)) {
    const amount = Number(customAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Укажите сумму пополнения' }
    }
    const min = product.min_amount ?? 0
    const max = product.max_amount ?? Number.MAX_SAFE_INTEGER
    if (amount < min || amount > max) {
      return { ok: false, error: `Сумма должна быть от ${min} до ${max} ₽` }
    }
    return { ok: true, linePrice: Math.round(amount) }
  }
  return { ok: true, linePrice: Math.round(Number(product.price) * quantity) }
}

/** Validate a requested quantity (whole number, 1..100). */
export function normalizeQuantity(raw: unknown): { ok: true; quantity: number } | { ok: false } {
  const qty = Math.floor(Number(raw) || 1)
  if (!Number.isFinite(qty) || qty < 1 || qty > 100) return { ok: false }
  return { ok: true, quantity: qty }
}

/**
 * Сумма возврата на баланс (₽) за непоставленные (failed) позиции заказа.
 * Возврат пропорционален вкладу проваленных позиций в сумму заказа, считается от ФИНАЛЬНОЙ
 * (уже со скидками) суммы — чтобы вернуть ровно столько, сколько было списано за эти позиции.
 * Если провалено всё — возвращаем весь финальный платёж (без потерь на округлении).
 */
export function proportionalRefund(
  finalAmount: number,
  failedLineTotal: number,
  totalAmount: number
): number {
  if (totalAmount <= 0 || failedLineTotal <= 0 || finalAmount <= 0) return 0
  if (failedLineTotal >= totalAmount) return finalAmount
  return Math.round((finalAmount * failedLineTotal) / totalAmount)
}

export interface ReferralLine {
  type: ProductType
  linePrice: number
}

/**
 * Referral bonus (₽) for the referrer, summed per line using the per-type percent
 * (DB settings first, then fallback constants), rounded once at the end.
 */
export function computeReferralBonus(
  lines: ReferralLine[],
  percentByType: Map<string, number>,
  fallbackByType: Record<string, number>
): number {
  let bonus = 0
  for (const l of lines) {
    const percent = percentByType.get(l.type) ?? fallbackByType[l.type] ?? 0
    bonus += (l.linePrice * percent) / 100
  }
  return Math.round(bonus)
}

/**
 * Уровень риска антифрода pay4game для платежа по корзине: 1 (низкий) … 5 (высокий).
 * Бизнес-правило: risk=1 ТОЛЬКО если ВСЕ позиции «низкорисковые» — авто-пополнения
 * (тип 'topup_auto': пополнение Steam, TG Stars). Любой обычный товар в корзине → risk=5.
 * Пустая корзина → 5 (консервативно). НЕ использует isTopup: topup_manual сюда НЕ входит.
 */
export function computeRisk(types: ProductType[]): 1 | 5 {
  if (types.length === 0) return 5
  return types.every((t) => t === 'topup_auto') ? 1 : 5
}
