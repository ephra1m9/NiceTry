// Моковый клиент AppRoute API
// В будущем заменить на реальные запросы к AppRoute

export interface AppRouteService {
  id: string
  name: string
  category: string
  type: 'instant' | 'topup_auto' | 'topup_manual' | 'manual'
  min_amount?: number
  max_amount?: number
  denominations?: AppRouteDenomination[]
  fields?: AppRouteField[]
}

export interface AppRouteDenomination {
  id: string
  name: string
  price_usd: number
  stock: number
}

export interface AppRouteField {
  name: string
  label: string
  type: 'text' | 'email' | 'phone' | 'number'
  required: boolean
  placeholder?: string
}

export interface AppRouteOrderRequest {
  service_id: string
  denomination_id?: string
  amount?: number
  fields?: Record<string, string>
  reference_id: string
}

export interface AppRouteOrderResponse {
  success: boolean
  order_id: string
  trace_id: string
  voucher_code?: string
  status: 'pending' | 'completed' | 'failed'
  message?: string
}

// Моковые данные для разработки
const MOCK_SERVICES: AppRouteService[] = [
  {
    id: 'steam_wallet',
    name: 'Steam Wallet',
    category: 'gaming',
    type: 'instant',
    denominations: [
      { id: 'steam_5', name: '$5 USD', price_usd: 5, stock: 100 },
      { id: 'steam_10', name: '$10 USD', price_usd: 10, stock: 150 },
      { id: 'steam_20', name: '$20 USD', price_usd: 20, stock: 200 },
      { id: 'steam_50', name: '$50 USD', price_usd: 50, stock: 80 },
      { id: 'steam_100', name: '$100 USD', price_usd: 100, stock: 50 },
    ],
  },
  {
    id: 'playstation_plus',
    name: 'PlayStation Plus',
    category: 'gaming',
    type: 'instant',
    denominations: [
      { id: 'ps_1m', name: '1 Month', price_usd: 9.99, stock: 120 },
      { id: 'ps_3m', name: '3 Months', price_usd: 24.99, stock: 90 },
      { id: 'ps_12m', name: '12 Months', price_usd: 59.99, stock: 60 },
    ],
  },
  {
    id: 'xbox_live',
    name: 'Xbox Live Gold',
    category: 'gaming',
    type: 'instant',
    denominations: [
      { id: 'xbox_1m', name: '1 Month', price_usd: 9.99, stock: 100 },
      { id: 'xbox_3m', name: '3 Months', price_usd: 24.99, stock: 75 },
      { id: 'xbox_12m', name: '12 Months', price_usd: 59.99, stock: 50 },
    ],
  },
  {
    id: 'netflix',
    name: 'Netflix Gift Card',
    category: 'streaming',
    type: 'instant',
    denominations: [
      { id: 'netflix_25', name: '$25 USD', price_usd: 25, stock: 80 },
      { id: 'netflix_50', name: '$50 USD', price_usd: 50, stock: 60 },
      { id: 'netflix_100', name: '$100 USD', price_usd: 100, stock: 40 },
    ],
  },
  {
    id: 'spotify',
    name: 'Spotify Premium',
    category: 'streaming',
    type: 'instant',
    denominations: [
      { id: 'spotify_1m', name: '1 Month', price_usd: 9.99, stock: 150 },
      { id: 'spotify_3m', name: '3 Months', price_usd: 29.99, stock: 100 },
      { id: 'spotify_6m', name: '6 Months', price_usd: 59.99, stock: 70 },
    ],
  },
  {
    id: 'mobile_topup',
    name: 'Mobile Phone Top-up',
    category: 'mobile',
    type: 'topup_auto',
    min_amount: 5,
    max_amount: 100,
    fields: [
      {
        name: 'phone',
        label: 'Phone Number',
        type: 'phone',
        required: true,
        placeholder: '+1234567890',
      },
    ],
  },
  {
    id: 'amazon_gift',
    name: 'Amazon Gift Card',
    category: 'shopping',
    type: 'instant',
    denominations: [
      { id: 'amazon_10', name: '$10 USD', price_usd: 10, stock: 200 },
      { id: 'amazon_25', name: '$25 USD', price_usd: 25, stock: 150 },
      { id: 'amazon_50', name: '$50 USD', price_usd: 50, stock: 100 },
      { id: 'amazon_100', name: '$100 USD', price_usd: 100, stock: 80 },
    ],
  },
  {
    id: 'google_play',
    name: 'Google Play Gift Card',
    category: 'gaming',
    type: 'instant',
    denominations: [
      { id: 'gplay_10', name: '$10 USD', price_usd: 10, stock: 180 },
      { id: 'gplay_25', name: '$25 USD', price_usd: 25, stock: 140 },
      { id: 'gplay_50', name: '$50 USD', price_usd: 50, stock: 90 },
      { id: 'gplay_100', name: '$100 USD', price_usd: 100, stock: 60 },
    ],
  },
]

/**
 * Получить список всех сервисов AppRoute
 */
export async function getServices(): Promise<AppRouteService[]> {
  // Имитация задержки API
  await new Promise((resolve) => setTimeout(resolve, 100))
  return MOCK_SERVICES
}

/**
 * Получить сервис по ID
 */
export async function getServiceById(
  serviceId: string
): Promise<AppRouteService | null> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  return MOCK_SERVICES.find((s) => s.id === serviceId) || null
}

/**
 * Получить деноминации для сервиса
 */
export async function getDenominations(
  serviceId: string
): Promise<AppRouteDenomination[]> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  const service = MOCK_SERVICES.find((s) => s.id === serviceId)
  return service?.denominations || []
}

/**
 * Создать заказ в AppRoute
 */
export async function createOrder(
  request: AppRouteOrderRequest
): Promise<AppRouteOrderResponse> {
  // Имитация задержки API
  await new Promise((resolve) => setTimeout(resolve, 300))

  const service = MOCK_SERVICES.find((s) => s.id === request.service_id)

  if (!service) {
    return {
      success: false,
      order_id: '',
      trace_id: '',
      status: 'failed',
      message: 'Service not found',
    }
  }

  // Для instant товаров генерируем моковый voucher
  if (service.type === 'instant') {
    const voucherCode = generateMockVoucher(service.id)
    return {
      success: true,
      order_id: `AR${Date.now()}`,
      trace_id: `TR${Date.now()}`,
      voucher_code: voucherCode,
      status: 'completed',
    }
  }

  // Для остальных типов возвращаем pending
  return {
    success: true,
    order_id: `AR${Date.now()}`,
    trace_id: `TR${Date.now()}`,
    status: 'pending',
    message: 'Order is being processed',
  }
}

/**
 * Генерация мокового ваучера
 */
function generateMockVoucher(serviceId: string): string {
  const prefix = serviceId.substring(0, 4).toUpperCase()
  const random = Math.random().toString(36).substring(2, 10).toUpperCase()
  return `${prefix}-${random}-MOCK`
}

/**
 * Проверить статус заказа
 */
export async function checkOrderStatus(
  orderId: string
): Promise<AppRouteOrderResponse> {
  await new Promise((resolve) => setTimeout(resolve, 100))

  return {
    success: true,
    order_id: orderId,
    trace_id: `TR${Date.now()}`,
    status: 'completed',
  }
}
