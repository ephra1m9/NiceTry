'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

interface Order {
  id: string
  order_number: string
  status: string
  total_amount: number
  discount_amount: number
  final_amount: number
  payment_method: string
  created_at: string
  items: OrderItem[]
}

interface OrderItem {
  id: string
  product_name: string
  quantity: number
  price: number
  voucher_code?: string
  delivery_status: string
}

export default function OrderPage() {
  const params = useParams()
  const orderId = params.id as string

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orderId) return

    fetch(`/api/orders/${orderId}`)
      .then((res) => res.json())
      .then((data) => {
        setOrder(data.order || null)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load order:', err)
        setLoading(false)
      })
  }, [orderId])

  if (loading) {
    return (
      <div className="container py-12 text-center">
        <div className="inline-block w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin"></div>
        <p className="text-muted mt-4">Загрузка заказа...</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="container py-12 text-center">
        <h1 className="text-2xl font-bold text-navy mb-4">Заказ не найден</h1>
        <Link href="/profile" className="text-blue hover:underline">
          Вернуться в профиль
        </Link>
      </div>
    )
  }

  return (
    <div className="container py-8">
      <div className="max-w-4xl mx-auto">
        {/* Заголовок */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold text-navy">
              Заказ #{order.order_number}
            </h1>
            <Badge variant={getStatusVariant(order.status)}>
              {getStatusLabel(order.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted">
            Создан: {new Date(order.created_at).toLocaleString('ru-RU')}
          </p>
        </div>

        {/* Успешное оформление */}
        {order.status === 'delivered' && (
          <div className="mb-6 p-4 bg-green-bg border border-green rounded-lg">
            <div className="flex items-start gap-3">
              <div className="text-2xl">✅</div>
              <div>
                <h3 className="font-semibold text-green mb-1">
                  Заказ успешно выполнен!
                </h3>
                <p className="text-sm text-muted">
                  Все товары доставлены. Коды активации указаны ниже.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Товары */}
        <Card className="mb-6">
          <div className="card-pad">
            <h2 className="text-xl font-bold text-navy mb-4">Товары</h2>

            <div className="space-y-4">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="pb-4 border-b border-border last:border-0"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-navy">
                        {item.product_name}
                      </h3>
                      <p className="text-sm text-muted">
                        {formatPrice(item.price)} × {item.quantity}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-navy">
                        {formatPrice(item.price * item.quantity)}
                      </p>
                      <Badge
                        variant={
                          item.delivery_status === 'delivered'
                            ? 'stock'
                            : 'amber'
                        }
                      >
                        {item.delivery_status === 'delivered'
                          ? 'Доставлено'
                          : 'В обработке'}
                      </Badge>
                    </div>
                  </div>

                  {/* Код активации */}
                  {item.voucher_code && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs text-muted mb-1">
                        Код активации:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm font-mono font-semibold text-navy bg-white px-3 py-2 rounded border border-blue-200">
                          {item.voucher_code}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(item.voucher_code!)
                            alert('Код скопирован в буфер обмена')
                          }}
                          className="btn btn-secondary btn-sm"
                        >
                          Копировать
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Итого */}
        <Card className="mb-6">
          <div className="card-pad">
            <h2 className="text-xl font-bold text-navy mb-4">Итого</h2>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Сумма товаров:</span>
                <span className="font-semibold">
                  {formatPrice(order.total_amount)}
                </span>
              </div>

              {order.discount_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Скидка:</span>
                  <span className="font-semibold text-green">
                    -{formatPrice(order.discount_amount)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-sm pt-2 border-t border-border">
                <span className="text-muted">Способ оплаты:</span>
                <span className="font-semibold">
                  {order.payment_method === 'balance'
                    ? 'Баланс'
                    : order.payment_method === 'card'
                    ? 'Банковская карта'
                    : 'Криптовалюта'}
                </span>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-border">
                <span className="text-lg font-bold text-navy">Оплачено:</span>
                <span className="text-2xl font-bold text-navy">
                  {formatPrice(order.final_amount)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Действия */}
        <div className="flex gap-4">
          <Link href="/profile" className="flex-1">
            <Button variant="secondary" className="w-full">
              Вернуться в профиль
            </Button>
          </Link>
          <Link href="/catalog" className="flex-1">
            <Button variant="primary" className="w-full">
              Продолжить покупки
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'new':
      return 'Новый'
    case 'paid':
      return 'Оплачен'
    case 'delivered':
      return 'Доставлен'
    case 'cancelled':
      return 'Отменён'
    default:
      return status
  }
}

function getStatusVariant(status: string): 'instant' | 'stock' | 'amber' | 'out' {
  switch (status) {
    case 'delivered':
      return 'stock'
    case 'paid':
      return 'instant'
    case 'new':
      return 'amber'
    case 'cancelled':
      return 'out'
    default:
      return 'amber'
  }
}
