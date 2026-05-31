// Утилиты для работы с Dessly API (заглушка)

export interface DesslyProduct {
  id: string
  name: string
  category: string
  price_usd: number
  platform: string
}

export interface DesslyOrderRequest {
  product_id: string
  recipient_email: string
  reference_id: string
}

export interface DesslyOrderResponse {
  order_id: string
  status: 'pending' | 'delivered' | 'failed'
  gift_link?: string
}

// ЗАГЛУШКА: Моковые данные для разработки
const MOCK_PRODUCTS: DesslyProduct[] = [
  {
    id: 'cyberpunk-2077',
    name: 'Cyberpunk 2077',
    category: 'Games',
    price_usd: 59.99,
    platform: 'Steam',
  },
  {
    id: 'elden-ring',
    name: 'Elden Ring',
    category: 'Games',
    price_usd: 49.99,
    platform: 'Steam',
  },
  {
    id: 'baldurs-gate-3',
    name: "Baldur's Gate 3",
    category: 'Games',
    price_usd: 59.99,
    platform: 'Steam',
  },
]

export class DesslyClient {
  private apiKey: string

  constructor() {
    this.apiKey = process.env.DESSLY_API_KEY || 'mock_key'
  }

  // ЗАГЛУШКА: Получить список продуктов
  async getProducts(): Promise<DesslyProduct[]> {
    console.log('[Dessly Mock] getProducts called')
    return Promise.resolve(MOCK_PRODUCTS)
  }

  // ЗАГЛУШКА: Создать заказ (отправка гифта)
  async createOrder(request: DesslyOrderRequest): Promise<DesslyOrderResponse> {
    console.log('[Dessly Mock] createOrder called:', request)

    return Promise.resolve({
      order_id: `dessly_${Date.now()}`,
      status: 'delivered',
      gift_link: `https://steam.mock/gift/${Math.random().toString(36).substring(7)}`,
    })
  }

  // ЗАГЛУШКА: Проверить статус заказа
  async getOrderStatus(orderId: string): Promise<DesslyOrderResponse> {
    console.log('[Dessly Mock] getOrderStatus called:', orderId)

    return Promise.resolve({
      order_id: orderId,
      status: 'delivered',
      gift_link: `https://steam.mock/gift/${Math.random().toString(36).substring(7)}`,
    })
  }
}

// Экспорт singleton instance
export const desslyClient = new DesslyClient()
