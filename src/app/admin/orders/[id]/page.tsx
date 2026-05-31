'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { OrderStatus } from '@/types'

interface Order {
  id: string
  order_number: string
  total_amount: number
  discount_amount: number
  final_amount: number
  status: OrderStatus
  payment_method: string
  delivery_data?: any
  created_at: string
  users?: {
    id: string
    email: string
    telegram_username?: string
    balance: number
  }
  items?: Array<{
    id: string
    product_name: string
    quantity: number
    price: number
    voucher_code?: string
    delivery_status?: string
  }>
}

export default function AdminOrderDetailPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params.id as string

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [newStatus, setNewStatus] = useState<OrderStatus>('new')
  const [deliveryData, setDeliveryData] = useState('')

  useEffect(() => {
    fetchOrder()
  }, [orderId])

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`)
      const data = await res.json()
      setOrder(data.order)
      setNewStatus(data.order.status)
      setDeliveryData(
        data.order.delivery_data ? JSON.stringify(data.order.delivery_data, null, 2) : ''
      )
    } catch (error) {
      console.error('Failed to fetch order:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateStatus = async () => {
    if (!order) return

    setUpdating(true)

    try {
      let parsedDeliveryData = null
      if (deliveryData.trim()) {
        try {
          parsedDeliveryData = JSON.parse(deliveryData)
        } catch (e) {
          alert('Неверный формат JSON в данных доставки')
          setUpdating(false)
          return
        }
      }

      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          delivery_data: parsedDeliveryData,
        }),
      })

      if (res.ok) {
        alert('Заказ обновлён')
        fetchOrder()
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to update order:', error)
      alert('Ошибка при обновлении заказа')
    } finally {
      setUpdating(false)
    }
  }

  const handleRefund = async () => {
    if (!order) return

    if (!confirm(`Вернуть ${order.final_amount} ₽ пользователю?`)) return

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: 'POST',
      })

      if (res.ok) {
        const data = await res.json()
        alert(`Возврат выполнен: ${data.refunded_amount} ₽`)
        fetchOrder()
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to refund order:', error)
      alert('Ошибка при возврате средств')
    }
  }

  const statusColors: Record<OrderStatus, string> = {
    new: 'badge-amber',
    paid: 'badge-instant',
    delivered: 'badge-stock',
    cancelled: 'badge-out',
  }

  const statusLabels: Record<OrderStatus, string> = {
    new: 'Новый',
    paid: 'Оплачен',
    delivered: 'Доставлен',
    cancelled: 'Отменён',
  }

  if (loading) {
    return (
      <div className="max-w-4xl">
        <div className="text-center py-12 text-muted">Загрузка...</div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="max-w-4xl">
        <div className="card card-pad text-center py-12 text-muted">
          Заказ не найден
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">
          Заказ #{order.order_number}
        </h1>
        <p className="text-muted">
          {new Date(order.created_at).toLocaleString('ru-RU')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Основная информация */}
        <div className="lg:col-span-2 space-y-6">
          {/* Информация о заказе */}
          <div className="card card-pad">
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Информация о заказе
            </h3>

            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted">Статус:</span>
                <span className={`badge ${statusColors[order.status]}`}>
                  {statusLabels[order.status]}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted">Способ оплаты:</span>
                <span className="font-semibold text-navy">
                  {order.payment_method === 'balance'
                    ? 'Баланс'
                    : order.payment_method === 'card'
                    ? 'Карта'
                    : 'Криптовалюта'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted">Сумма товаров:</span>
                <span className="font-semibold text-navy">
                  {Number(order.total_amount).toFixed(2)} ₽
                </span>
              </div>

              {order.discount_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Скидка:</span>
                  <span className="font-semibold text-red">
                    -{Number(order.discount_amount).toFixed(2)} ₽
                  </span>
                </div>
              )}

              <div className="flex justify-between pt-3 border-t border-border">
                <span className="text-navy font-bold">Итого:</span>
                <span className="text-navy font-bold text-lg">
                  {Number(order.final_amount).toFixed(2)} ₽
                </span>
              </div>
            </div>
          </div>

          {/* Товары */}
          <div className="card">
            <div className="p-6 border-b border-border">
              <h3 className="text-[17px] font-bold text-navy">Товары</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {order.items?.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between p-4 rounded-lg border border-border"
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-navy mb-1">
                        {item.product_name}
                      </div>
                      <div className="text-sm text-muted">
                        Количество: {item.quantity}
                      </div>
                      {item.voucher_code && (
                        <div className="text-sm text-muted mt-1">
                          Код: <span className="font-mono">{item.voucher_code}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-navy">
                        {Number(item.price).toFixed(2)} ₽
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Управление заказом */}
          <div className="card card-pad">
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Управление заказом
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Изменить статус
                </label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as OrderStatus)}
                  className="input"
                >
                  <option value="new">Новый</option>
                  <option value="paid">Оплачен</option>
                  <option value="delivered">Доставлен</option>
                  <option value="cancelled">Отменён</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Данные доставки (JSON)
                </label>
                <textarea
                  value={deliveryData}
                  onChange={(e) => setDeliveryData(e.target.value)}
                  className="input min-h-[100px] font-mono text-sm"
                  rows={4}
                  placeholder='{"voucher": "CODE-123", "instructions": "..."}'
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleUpdateStatus}
                  disabled={updating}
                  className="btn btn-primary"
                >
                  {updating ? 'Обновление...' : 'Обновить заказ'}
                </button>

                {order.status !== 'cancelled' && (
                  <button onClick={handleRefund} className="btn btn-ghost text-red">
                    Вернуть средства
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Информация о пользователе */}
        <div className="space-y-6">
          <div className="card card-pad">
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Пользователь
            </h3>

            <div className="space-y-3">
              <div>
                <div className="text-sm text-muted mb-1">Email</div>
                <div className="font-semibold text-navy">
                  {order.users?.email || 'Гость'}
                </div>
              </div>

              {order.users?.telegram_username && (
                <div>
                  <div className="text-sm text-muted mb-1">Telegram</div>
                  <div className="font-semibold text-navy">
                    @{order.users.telegram_username}
                  </div>
                </div>
              )}

              <div>
                <div className="text-sm text-muted mb-1">Баланс</div>
                <div className="font-semibold text-navy">
                  {Number(order.users?.balance || 0).toFixed(2)} ₽
                </div>
              </div>

              {order.users?.id && (
                <button
                  onClick={() => router.push(`/admin/users/${order.users?.id}`)}
                  className="btn btn-sm btn-ghost w-full mt-4"
                >
                  Открыть профиль
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
