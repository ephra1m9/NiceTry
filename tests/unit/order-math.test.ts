import { describe, it, expect } from 'vitest'
import {
  statusDiscount,
  promoDiscount,
  settleAmounts,
  isPromoApplicable,
  computeLinePrice,
  normalizeQuantity,
  computeReferralBonus,
  isTopup,
  proportionalRefund,
  computeRisk,
} from '@/lib/order-math'
import { REFERRAL_PERCENTS } from '@/lib/constants'

describe('proportionalRefund — возврат за непоставленные позиции', () => {
  it('провалено всё → возвращается весь финальный платёж (без потерь округления)', () => {
    expect(proportionalRefund(900, 1000, 1000)).toBe(900) // finalAmount возвращается целиком
    expect(proportionalRefund(1000, 1000, 1000)).toBe(1000)
  })
  it('провалена половина суммы → половина финального платежа', () => {
    expect(proportionalRefund(900, 500, 1000)).toBe(450)
  })
  it('пропорция от ФИНАЛЬНОЙ (со скидкой) суммы, округление до рубля', () => {
    // final 912, провалено 333 из 1000 → 912*333/1000 = 303.7 → 304
    expect(proportionalRefund(912, 333, 1000)).toBe(304)
  })
  it('ничего не провалено → 0', () => {
    expect(proportionalRefund(900, 0, 1000)).toBe(0)
  })
  it('защита от некорректных входов → 0', () => {
    expect(proportionalRefund(0, 500, 1000)).toBe(0)
    expect(proportionalRefund(900, 500, 0)).toBe(0)
    expect(proportionalRefund(900, -5, 1000)).toBe(0)
  })
  it('провалено больше суммы (защита) → весь финальный платёж', () => {
    expect(proportionalRefund(900, 1500, 1000)).toBe(900)
  })
})

describe('computeRisk — уровень риска антифрода pay4game', () => {
  it('все позиции topup_auto → risk=1', () => {
    expect(computeRisk(['topup_auto'])).toBe(1)
    expect(computeRisk(['topup_auto', 'topup_auto'])).toBe(1)
  })
  it('хотя бы один обычный товар → risk=5', () => {
    expect(computeRisk(['topup_auto', 'instant'])).toBe(5)
    expect(computeRisk(['instant'])).toBe(5)
  })
  it('topup_manual НЕ считается низкорисковым → risk=5', () => {
    expect(computeRisk(['topup_manual'])).toBe(5)
    expect(computeRisk(['topup_auto', 'topup_manual'])).toBe(5)
  })
  it('пустая корзина → risk=5 (консервативно)', () => {
    expect(computeRisk([])).toBe(5)
  })
})

describe('statusDiscount', () => {
  it('5% от 1000 = 50', () => {
    expect(statusDiscount(1000, 5)).toBe(50)
  })
  it('0% → 0', () => {
    expect(statusDiscount(1000, 0)).toBe(0)
  })
  it('отрицательный/NaN процент → 0 (защита)', () => {
    expect(statusDiscount(1000, -5)).toBe(0)
    expect(statusDiscount(1000, NaN)).toBe(0)
  })
  it('округляет до целого рубля', () => {
    // 8% от 913 = 73.04 → 73
    expect(statusDiscount(913, 8)).toBe(73)
  })
})

describe('promoDiscount', () => {
  it('процентный промокод: 10% от 2000 = 200', () => {
    expect(promoDiscount(2000, 'percent', 10)).toBe(200)
  })
  it('фиксированный промокод: 300 ₽', () => {
    expect(promoDiscount(2000, 'fixed', 300)).toBe(300)
  })
  it('значение 0 или отрицательное → 0', () => {
    expect(promoDiscount(2000, 'percent', 0)).toBe(0)
    expect(promoDiscount(2000, 'fixed', -100)).toBe(0)
  })
})

describe('settleAmounts — клемпинг скидки и финальная сумма', () => {
  it('обычный случай', () => {
    expect(settleAmounts(1000, 150)).toEqual({ discount: 150, final: 850 })
  })
  it('скидка больше суммы → финал не уходит в минус (clamp до total)', () => {
    expect(settleAmounts(1000, 5000)).toEqual({ discount: 1000, final: 0 })
  })
  it('отрицательная скидка обнуляется', () => {
    expect(settleAmounts(1000, -50)).toEqual({ discount: 0, final: 1000 })
  })
  it('финальная сумма НИКОГДА не отрицательна и не больше total', () => {
    for (const total of [0, 1, 999, 100000]) {
      for (const d of [-100, 0, 50, total, total + 1, total * 3]) {
        const { discount, final } = settleAmounts(total, d)
        expect(final).toBeGreaterThanOrEqual(0)
        expect(final).toBeLessThanOrEqual(total)
        expect(discount).toBeGreaterThanOrEqual(0)
        expect(discount).toBeLessThanOrEqual(total)
        expect(final).toBe(total - discount)
      }
    }
  })
})

describe('isPromoApplicable', () => {
  const now = new Date('2026-05-31T12:00:00Z')
  it('активный, без срока и лимита → применим', () => {
    expect(isPromoApplicable({ is_active: true }, now)).toBe(true)
  })
  it('null промокод → не применим', () => {
    expect(isPromoApplicable(null, now)).toBe(false)
  })
  it('явно неактивный → не применим', () => {
    expect(isPromoApplicable({ is_active: false }, now)).toBe(false)
  })
  it('просроченный → не применим', () => {
    expect(isPromoApplicable({ expires_at: '2020-01-01T00:00:00Z' }, now)).toBe(false)
  })
  it('срок в будущем → применим', () => {
    expect(isPromoApplicable({ expires_at: '2030-01-01T00:00:00Z' }, now)).toBe(true)
  })
  it('исчерпан лимит использований → не применим', () => {
    expect(isPromoApplicable({ max_uses: 5, used_count: 5 }, now)).toBe(false)
    expect(isPromoApplicable({ max_uses: 5, used_count: 6 }, now)).toBe(false)
  })
  it('лимит ещё не исчерпан → применим', () => {
    expect(isPromoApplicable({ max_uses: 5, used_count: 4 }, now)).toBe(true)
  })
  it('граница срока: ровно сейчас не считается просроченным', () => {
    expect(isPromoApplicable({ expires_at: now.toISOString() }, now)).toBe(true)
  })
})

describe('normalizeQuantity', () => {
  it('по умолчанию 1', () => {
    expect(normalizeQuantity(undefined)).toEqual({ ok: true, quantity: 1 })
  })
  it('целое в диапазоне 1..100', () => {
    expect(normalizeQuantity(5)).toEqual({ ok: true, quantity: 5 })
    expect(normalizeQuantity(100)).toEqual({ ok: true, quantity: 100 })
  })
  it('дробное усекается вниз', () => {
    expect(normalizeQuantity(3.9)).toEqual({ ok: true, quantity: 3 })
  })
  it('0 трактуется как 1 (Number(0)||1 — заказать ноль штук нельзя)', () => {
    // Совпадает с исходной логикой роута: безвредно, клиент не может заказать 0.
    expect(normalizeQuantity(0)).toEqual({ ok: true, quantity: 1 })
  })
  it('отрицательное, >100 → ошибка', () => {
    expect(normalizeQuantity(-1).ok).toBe(false)
    expect(normalizeQuantity(101).ok).toBe(false)
    expect(normalizeQuantity(1000).ok).toBe(false)
  })
  it('нечисловой ввод → 1 (Number||1) либо ошибка для явного мусора', () => {
    // "abc" → Number=NaN → ||1 → 1
    expect(normalizeQuantity('abc')).toEqual({ ok: true, quantity: 1 })
  })
})

describe('computeLinePrice', () => {
  const fixed = { type: 'instant' as const, price: 912 }
  const topup = { type: 'topup_auto' as const, price: 0, min_amount: 92, max_amount: 45600 }

  it('фиксированный товар: цена × количество', () => {
    expect(computeLinePrice(fixed, 3)).toEqual({ ok: true, linePrice: 2736 })
  })
  it('фиксированный товар количество 1', () => {
    expect(computeLinePrice(fixed, 1)).toEqual({ ok: true, linePrice: 912 })
  })
  it('пополнение: берётся введённая сумма', () => {
    expect(computeLinePrice(topup, 1, 1000)).toEqual({ ok: true, linePrice: 1000 })
  })
  it('пополнение без суммы → ошибка', () => {
    const r = computeLinePrice(topup, 1, undefined)
    expect(r.ok).toBe(false)
  })
  it('пополнение: сумма ниже минимума → ошибка', () => {
    const r = computeLinePrice(topup, 1, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('от 92 до 45600')
  })
  it('пополнение: сумма выше максимума → ошибка', () => {
    expect(computeLinePrice(topup, 1, 99999).ok).toBe(false)
  })
  it('пополнение: граничные значения min/max допустимы', () => {
    expect(computeLinePrice(topup, 1, 92)).toEqual({ ok: true, linePrice: 92 })
    expect(computeLinePrice(topup, 1, 45600)).toEqual({ ok: true, linePrice: 45600 })
  })
  it('пополнение: отрицательная/нулевая сумма → ошибка', () => {
    expect(computeLinePrice(topup, 1, 0).ok).toBe(false)
    expect(computeLinePrice(topup, 1, -100).ok).toBe(false)
  })
})

describe('isTopup', () => {
  it('topup_auto и topup_manual — пополнения', () => {
    expect(isTopup('topup_auto')).toBe(true)
    expect(isTopup('topup_manual')).toBe(true)
  })
  it('instant и manual — нет', () => {
    expect(isTopup('instant')).toBe(false)
    expect(isTopup('manual')).toBe(false)
  })
})

describe('computeReferralBonus', () => {
  const fallback = REFERRAL_PERCENTS as unknown as Record<string, number>

  it('использует процент из БД-настроек при наличии', () => {
    const settings = new Map([['instant', 12]])
    // 1000 × 12% = 120
    expect(computeReferralBonus([{ type: 'instant', linePrice: 1000 }], settings, fallback)).toBe(120)
  })

  it('фолбэк на константы, если в настройках нет типа', () => {
    const settings = new Map<string, number>()
    // topup_auto fallback = 15% → 1000 × 15% = 150
    expect(computeReferralBonus([{ type: 'topup_auto', linePrice: 1000 }], settings, fallback)).toBe(150)
  })

  it('суммирует по строкам и округляет один раз в конце', () => {
    const settings = new Map([['instant', 12], ['manual', 10]])
    // 333×12% = 39.96 ; 333×10% = 33.3 ; сумма 73.26 → round = 73
    const bonus = computeReferralBonus(
      [
        { type: 'instant', linePrice: 333 },
        { type: 'manual', linePrice: 333 },
      ],
      settings,
      fallback
    )
    expect(bonus).toBe(73)
  })

  it('неизвестный тип без фолбэка → 0%', () => {
    const settings = new Map<string, number>()
    expect(computeReferralBonus([{ type: 'instant', linePrice: 1000 }], settings, {})).toBe(0)
  })

  it('пустой список → 0', () => {
    expect(computeReferralBonus([], new Map(), fallback)).toBe(0)
  })
})
