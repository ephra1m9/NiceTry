// Константы проекта

export const SITE_NAME = 'NiceTry'
export const SITE_DESCRIPTION = 'Магазин цифровых товаров'

export const PRODUCT_TYPES = {
  instant: 'Моментальная выдача',
  topup_auto: 'Автопополнение',
  topup_manual: 'Ручное пополнение',
  manual: 'Ручная обработка',
} as const

export const ORDER_STATUSES = {
  new: 'Новый',
  paid: 'Оплачен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
} as const

export const PAYMENT_METHODS = {
  balance: 'Баланс',
  card: 'Банковская карта',
  crypto: 'Криптовалюта',
} as const

export const USER_STATUSES = {
  bronze: { name: 'Bronze', discount: 0, minSpent: 0 },
  silver: { name: 'Silver', discount: 5, minSpent: 5000 },
  gold: { name: 'Gold', discount: 8, minSpent: 10000 },
} as const

export const REFERRAL_PERCENTS = {
  instant: 12,
  topup_auto: 15,
  topup_manual: 10,
  manual: 10,
} as const

export const DEFAULT_MARKUP_PERCENT = 14
export const DEFAULT_USD_TO_RUB = 80

export const ITEMS_PER_PAGE = 20
export const MAX_CART_ITEMS = 50
