// Основные типы проекта NiceTry

export type ProductType = 'instant' | 'topup_auto' | 'topup_manual' | 'manual'

export type OrderStatus = 'new' | 'paid' | 'delivered' | 'cancelled'

export type PaymentMethod = 'balance' | 'card' | 'crypto'

export interface User {
  id: string
  email: string
  nickname?: string | null
  telegram_id?: string
  balance: number
  status: UserStatus
  referral_code: string
  referred_by?: string
  is_admin?: boolean
  created_at: string
}

export interface UserStatus {
  name: string
  discount_percent: number
}

export interface Product {
  id: string
  name: string
  description: string
  type: ProductType
  category_id: string
  category?: {
    name: string
    slug: string
  }
  price: number
  price_usd?: number | null
  original_price?: number
  stock?: number
  is_active: boolean
  supplier: 'approute' | 'dessly'
  supplier_id?: string
  supplier_service_id?: string
  denomination_id?: string
  image_url?: string
  min_amount?: number
  max_amount?: number
  supplier_fields?: any
  region?: string | null
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  user_id: string
  products: OrderItem[]
  total_amount: number
  discount_amount: number
  final_amount: number
  status: OrderStatus
  payment_method: PaymentMethod
  promo_code?: string
  delivery_data?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface OrderItem {
  product_id: string
  quantity: number
  price: number
  voucher_code?: string
}

export interface PromoCode {
  id: string
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  max_uses?: number
  used_count: number
  expires_at?: string
  is_active: boolean
  created_at: string
}

export interface Category {
  id: string
  name: string
  slug: string
  icon?: string
  markup_percent: number
  supplier: 'approute' | 'dessly'
  is_active: boolean
  sort_order: number
}

// ============================================================
// Прокси px6 (proxy6)
// ============================================================

export interface ProxySettings {
  markup_percent: number
  usd_to_rub_rate: number
  is_enabled: boolean
  allowed_periods: number[]
  max_count: number
}

export interface ProxyOrder {
  id: string
  user_id: string | null
  order_id: string | null
  version: 3 | 4 | 5 | 6
  country: string
  count: number
  period: number
  proxy_type?: string | null
  price_internal: number
  px6_price?: number | null
  px6_currency?: 'RUB' | 'USD' | null
  px6_order_id?: string | null
  proxies?: ProxyItem[] | null
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  created_at: string
  updated_at: string
}

/** Один выданный прокси (как хранится в proxy_orders.proxies jsonb). */
export interface ProxyItem {
  id: string
  ip: string
  host: string
  port: string
  user: string
  pass: string
  type: string
  country: string
  date: string
  date_end: string
  active: boolean
}
