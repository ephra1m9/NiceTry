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

// Цена в рублях в формате ТЗ §6: разделитель тысяч — пробел, копейки только при наличии
// дробной части («1 499 ₽», «1 499,50 ₽»). Неразрывный пробел перед ₽.
export function formatRub(amount: number): string {
  const value = Number(amount) || 0
  const hasFraction = Math.round(value * 100) % 100 !== 0
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value)
  return `${formatted} ₽`
}

// Типовые слова в конце названия бренда («Gift Card», «Wallet» и т.п.) переводим на русский
// и выносим вперёд — так понятнее покупателю, что именно он покупает. Порядок важен: более
// длинные/специфичные фразы проверяются раньше коротких («wallet code» раньше «wallet»/«code»),
// иначе короткая фраза «откусит» лишнее.
// «Gift Card», «Gift Code», «Wallet Code» и «Wallet» для покупателя — один и тот же продукт
// (код пополнения кошелька платформы), в рунете его называют «подарочная карта», а не
// «код кошелька» — поэтому у всех этих синонимов один и тот же перевод.
const TYPE_WORD_RULES: [RegExp, string][] = [
  [/\bgift\s+card$/i, 'Подарочная карта'],
  [/\bgift\s+code$/i, 'Подарочная карта'],
  [/\bwallet\s+code$/i, 'Подарочная карта'],
  [/\bwallet$/i, 'Подарочная карта'],
  [/\btop[\s-]?up$/i, 'Пополнение'],
  [/\bsubscription$/i, 'Подписка'],
  [/\bmembership$/i, 'Подписка'],
  [/\bpoints?$/i, 'Баллы'],
  [/\bkey$/i, 'Ключ'],
  [/\bcode$/i, 'Код'],
]

function translateProductTypeWord(brand: string): string {
  for (const [re, ru] of TYPE_WORD_RULES) {
    const m = brand.match(re)
    if (m && m.index !== undefined) {
      const core = brand.slice(0, m.index).trim().replace(/[|,-]+$/, '').trim()
      return core ? `${ru} ${core}` : ru
    }
  }
  return brand
}

// Названия товаров от поставщиков склеены из сырых полей API и плохо читаются покупателем,
// например: «PlayStation®Store Wallet | CZ — CZK 1500 PlayStation®Store Wallet gift card»
// (бренд + регион через "|", сумма + дублирующее описание через "—"). Разбираем эту структуру
// и собираем компактный вид «Бренд — сумма (регион)», отбрасывая дублирующий хвост-описание,
// а типовые слова бренда переводим на русский (translateProductTypeWord).
// Названия без такой структуры (ручные товары, Dessly-игры) возвращаются без изменений.
export function formatProductTitle(rawName: string): string {
  if (!rawName) return rawName

  let region = ''
  let rest = rawName

  const trailingRegion = rest.match(/\s\(([A-Za-z]{2,3})\)\s*$/)
  if (trailingRegion) {
    region = trailingRegion[1].toUpperCase()
    rest = rest.slice(0, trailingRegion.index).trim()
  }

  const dashIdx = rest.indexOf(' — ')
  let left = dashIdx !== -1 ? rest.slice(0, dashIdx) : rest
  const right = dashIdx !== -1 ? rest.slice(dashIdx + 3).trim() : ''

  const pipeIdx = left.indexOf(' | ')
  if (pipeIdx !== -1) {
    if (!region) region = left.slice(pipeIdx + 3).trim().toUpperCase()
    left = left.slice(0, pipeIdx)
  }

  const brand = translateProductTypeWord(left.replace(/[®™]/g, ' ').replace(/\s+/g, ' ').trim())

  let amount = ''
  const dollarMatch = right.match(/^\$\s?([\d.,]+)/)
  const currencyMatch = right.match(/^([A-Z]{3})\s+([\d.,]+)/)
  if (dollarMatch) {
    amount = `$${dollarMatch[1]}`
  } else if (currencyMatch) {
    amount = `${currencyMatch[2]} ${currencyMatch[1]}`
  }

  let tail = amount
  if (!tail && right) {
    const brandLower = brand.toLowerCase()
    const rightLower = right.toLowerCase()
    if (!brandLower.includes(rightLower) && !rightLower.includes(brandLower)) {
      tail = right
    }
  }

  let result = tail ? `${brand} — ${tail}` : brand
  if (region) result += ` (${region})`
  return result
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
