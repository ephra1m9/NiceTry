// Утилиты для форматирования

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 2,
  }).format(price)
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('ru-RU').format(num)
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

export function generateReferralCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

export function generateOrderNumber(): string {
  return `NT-${Math.floor(Math.random() * 999999).toString().padStart(6, '0')}`
}

export function calculateDiscount(
  price: number,
  discountPercent: number
): number {
  return price * (1 - discountPercent / 100)
}

export function applyPromoCode(
  total: number,
  promoType: 'percent' | 'fixed',
  promoValue: number
): number {
  if (promoType === 'percent') {
    return total * (1 - promoValue / 100)
  }
  return Math.max(0, total - promoValue)
}
