'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import { formatProductTitle } from '@/lib/utils'

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
  const [copiedId, setCopiedId] = useState<string | null>(null)

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

  const copyCode = (item: OrderItem) => {
    if (!item.voucher_code) return
    navigator.clipboard.writeText(item.voucher_code).then(() => {
      setCopiedId(item.id)
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 2000)
    })
  }

  if (loading) {
    return (
      <div className="container py-8">
        <Spinner label="Загрузка заказа…" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
          </div>
          <h3>Заказ не найден</h3>
          <p>Возможно, ссылка устарела или заказ принадлежит другому аккаунту.</p>
          <Link href="/profile" className="btn btn-primary mt-1">Вернуться в профиль</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-6 sm:py-8">
      <div className="max-w-4xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <h1>Заказ #{order.order_number}</h1>
          <Badge variant={getStatusVariant(order.status)}>{getStatusLabel(order.status)}</Badge>
        </div>
        <p className="text-sm text-muted mb-6">Создан: {new Date(order.created_at).toLocaleString('ru-RU')}</p>

        {/* Успешное оформление */}
        {order.status === 'delivered' && (
          <div className="alert alert-success mb-6">
            <svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
            <div>
              <div className="font-semibold">Заказ успешно выполнен!</div>
              <p className="text-[13px] opacity-90 mt-0.5">Все товары доставлены. Коды активации указаны ниже.</p>
            </div>
          </div>
        )}

        {/* Товары */}
        <Card className="mb-5" padding={false}>
          <div className="card-pad">
            <h2 className="mb-4">Товары</h2>
            <div className="space-y-4">
              {order.items.map((item) => (
                <div key={item.id} className="pb-4 border-b border-border-2 last:border-0 last:pb-0">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="truncate">{formatProductTitle(item.product_name)}</h3>
                      <p className="text-sm text-muted">{formatPrice(item.price)} × {item.quantity}</p>
                    </div>
                    <div className="text-right flex-none">
                      <p className="font-semibold text-navy whitespace-nowrap">{formatPrice(item.price * item.quantity)}</p>
                      <Badge variant={item.delivery_status === 'delivered' ? 'stock' : 'amber'} className="mt-1">
                        {item.delivery_status === 'delivered' ? 'Доставлено' : 'В обработке'}
                      </Badge>
                    </div>
                  </div>

                  {item.voucher_code && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs text-muted mb-1.5">Код активации</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 text-sm font-mono font-semibold text-navy bg-white px-3 py-2 rounded border border-blue-200 truncate">
                          {item.voucher_code}
                        </code>
                        <button
                          onClick={() => copyCode(item)}
                          className={`btn btn-sm flex-none ${copiedId === item.id ? 'btn-secondary' : 'btn-secondary'}`}
                          aria-label="Копировать код"
                        >
                          {copiedId === item.id ? (
                            <>
                              <svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
                              Готово
                            </>
                          ) : (
                            'Копировать'
                          )}
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
        <Card className="mb-5" padding={false}>
          <div className="card-pad">
            <h2 className="mb-4">Итого</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Сумма товаров</span>
                <span className="font-semibold">{formatPrice(order.total_amount)}</span>
              </div>
              {order.discount_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Скидка</span>
                  <span className="font-semibold text-green">−{formatPrice(order.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm pt-2 border-t border-border-2">
                <span className="text-muted">Способ оплаты</span>
                <span className="font-semibold">
                  {order.payment_method === 'balance'
                    ? 'Баланс'
                    : order.payment_method === 'card'
                    ? 'Банковская карта'
                    : order.payment_method === 'mock'
                    ? 'Банковская карта'
                    : 'Криптовалюта'}
                </span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-border">
                <span className="text-lg font-bold text-navy">Оплачено</span>
                <span className="text-2xl font-extrabold text-navy">{formatPrice(order.final_amount)}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Действия */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/profile" className="btn btn-secondary flex-1">Вернуться в профиль</Link>
          <Link href="/catalog" className="btn btn-primary flex-1">Продолжить покупки</Link>
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
