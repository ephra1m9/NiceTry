'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { OrderStatus } from '@/types'

interface Order {
  id: string
  order_number: string
  final_amount: number
  status: OrderStatus
  created_at: string
  users?: {
    email: string
    telegram_username?: string
  }
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    status: '',
    search: '',
    date_from: '',
    date_to: '',
  })

  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.search) params.set('search', filters.search)
      if (filters.date_from) params.set('date_from', filters.date_from)
      if (filters.date_to) params.set('date_to', filters.date_to)

      const res = await fetch(`/api/admin/orders?${params}`)
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (error) {
      console.error('Failed to fetch orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleSearch = () => {
    fetchOrders()
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

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Заказы</h1>
        <p className="text-muted">Управление заказами и обработка</p>
      </div>

      {/* Фильтры */}
      <div className="card card-pad mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="Поиск по номеру или email..."
            className="input"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />

          <select
            className="input"
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
          >
            <option value="">Все статусы</option>
            <option value="new">Новый</option>
            <option value="paid">Оплачен</option>
            <option value="delivered">Доставлен</option>
            <option value="cancelled">Отменён</option>
          </select>

          <input
            type="date"
            className="input"
            value={filters.date_from}
            onChange={(e) => handleFilterChange('date_from', e.target.value)}
          />

          <input
            type="date"
            className="input"
            value={filters.date_to}
            onChange={(e) => handleFilterChange('date_to', e.target.value)}
          />
        </div>

        <div className="mt-4">
          <button onClick={handleSearch} className="btn btn-primary">
            Применить фильтры
          </button>
        </div>
      </div>

      {/* Список заказов */}
      {loading ? (
        <div className="text-center py-12 text-muted">Загрузка...</div>
      ) : orders.length === 0 ? (
        <div className="card card-pad text-center py-12 text-muted">
          Заказы не найдены
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Номер заказа
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Пользователь
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Сумма
                  </th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">
                    Статус
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Дата
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-border hover:bg-gray-bg"
                  >
                    <td className="p-4">
                      <div className="font-semibold text-navy">
                        #{order.order_number}
                      </div>
                    </td>
                    <td className="p-4 text-muted">
                      {order.users?.email || 'Гость'}
                    </td>
                    <td className="p-4 text-right font-semibold text-navy">
                      {Number(order.final_amount).toFixed(2)} ₽
                    </td>
                    <td className="p-4 text-center">
                      <span className={`badge ${statusColors[order.status]}`}>
                        {statusLabels[order.status]}
                      </span>
                    </td>
                    <td className="p-4 text-muted">
                      {new Date(order.created_at).toLocaleString('ru-RU')}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="btn btn-sm btn-ghost"
                      >
                        Подробнее
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
