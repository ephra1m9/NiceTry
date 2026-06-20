'use client'

import { useEffect, useState } from 'react'

interface TelegramOrder {
  id: string
  product_type: 'stars' | 'premium'
  amount: number
  recipient_username: string
  price_usd: number
  price_rub: number
  status: 'pending' | 'completed' | 'failed'
  supplier_order_id?: string | null
  created_at: string
  users?: { email: string } | null
}

const STATUS_LABELS: Record<TelegramOrder['status'], string> = {
  pending: 'В обработке',
  completed: 'Выдано',
  failed: 'Отменено',
}

const STATUS_CLASS: Record<TelegramOrder['status'], string> = {
  pending: 'badge-amber',
  completed: 'badge-stock',
  failed: 'badge-out',
}

function packageLabel(o: TelegramOrder): string {
  return o.product_type === 'stars' ? `${o.amount} звёзд` : `Premium · ${o.amount} мес.`
}

export default function AdminTelegramOrdersPage() {
  const [orders, setOrders] = useState<TelegramOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [actingId, setActingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [syncing, setSyncing] = useState(false)

  const fetchOrders = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/telegram-orders?${params}`, { cache: 'no-store' })
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (error) {
      console.error('Failed to fetch telegram orders:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Синхронизация пакетов Stars/Premium из AppRoute в telegram_packages (читает модалка покупки).
  const handleSync = async () => {
    setSyncing(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/sync-telegram', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ type: 'err', text: body.error || 'Не удалось синхронизировать пакеты' })
        return
      }
      setMsg({ type: 'ok', text: `Синхронизировано: ${body.stars} Stars, ${body.premium} Premium` })
    } catch {
      setMsg({ type: 'err', text: 'Ошибка сети' })
    } finally {
      setSyncing(false)
    }
  }

  const setOrderStatus = async (id: string, next: 'completed' | 'failed') => {
    setActingId(id)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/telegram-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ type: 'err', text: body.error || 'Не удалось обновить заявку' })
        return
      }
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: next } : o)))
      setMsg({ type: 'ok', text: next === 'completed' ? 'Отмечено как выдано' : 'Отменено, средства возвращены' })
    } catch {
      setMsg({ type: 'err', text: 'Ошибка сети' })
    } finally {
      setActingId(null)
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[30px] font-bold text-navy mb-2">Telegram Stars / Premium</h1>
          <p className="text-muted">
            Выдача автоматическая через AppRoute, большинство заявок сразу «Выдано». В обработке
            остаются только зависшие у поставщика — сверьте supplier_order_id в кабинете AppRoute,
            затем отметьте вручную: «Выдано», если дошло, или «Отменить» — деньги вернутся покупателю.
          </p>
        </div>
        <button onClick={handleSync} disabled={syncing} className="btn btn-secondary">
          {syncing ? 'Синхронизация…' : 'Синхронизировать пакеты'}
        </button>
      </div>

      {msg && (
        <div className={`alert mb-4 ${msg.type === 'ok' ? 'alert-success' : 'alert-error'}`}>
          <span>{msg.text}</span>
        </div>
      )}

      <div className="card card-pad mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="Поиск по username или email..."
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchOrders()}
          />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Все статусы</option>
            <option value="pending">В обработке</option>
            <option value="completed">Выдано</option>
            <option value="failed">Отменено</option>
          </select>
          <button onClick={fetchOrders} className="btn btn-primary">
            Применить
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted">Загрузка...</div>
      ) : orders.length === 0 ? (
        <div className="card card-pad text-center py-12 text-muted">Заявок не найдено</div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Пакет</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Получатель</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Покупатель</th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">Сумма</th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">Статус</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">AppRoute ID</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Дата</th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">Действия</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-border hover:bg-gray-bg">
                    <td className="p-4 font-semibold text-navy">{packageLabel(order)}</td>
                    <td className="p-4 text-muted">@{order.recipient_username}</td>
                    <td className="p-4 text-muted">{order.users?.email || '—'}</td>
                    <td className="p-4 text-right font-semibold text-navy">{Number(order.price_rub).toFixed(0)} ₽</td>
                    <td className="p-4 text-center">
                      <span className={`badge ${STATUS_CLASS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
                    </td>
                    <td className="p-4 text-muted-2 text-xs font-mono">{order.supplier_order_id || '—'}</td>
                    <td className="p-4 text-muted">{new Date(order.created_at).toLocaleString('ru-RU')}</td>
                    <td className="p-4 text-right">
                      {order.status === 'pending' && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={actingId === order.id}
                            onClick={() => setOrderStatus(order.id, 'completed')}
                          >
                            Выдано
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={actingId === order.id}
                            onClick={() => setOrderStatus(order.id, 'failed')}
                          >
                            Отменить
                          </button>
                        </div>
                      )}
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
