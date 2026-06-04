'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

/**
 * Раздел «Заказы» в профиле (сайт + Mini App).
 * Список заказов пользователя из /api/orders: номер, дата, статус, состав,
 * сумма, способ оплаты, применённый промокод/скидка, выданные ключи.
 * Сортировка от новых к старым, пагинация «Показать ещё». Открытие заказа →
 * детальная страница /orders/[id].
 */

interface OrderItem {
  id: string
  product_name: string
  quantity: number
  price: number
  voucher_code?: string | null
  delivery_status: string
}

interface OrderRow {
  id: string
  order_number: string
  status: string
  total_amount: number
  discount_amount: number
  final_amount: number
  payment_method: string
  created_at: string
  items: OrderItem[]
  promo?: { code: string } | null
}

const PAGE_SIZE = 5

export default function OrdersSection() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (nextPage: number) => {
    const first = nextPage === 1
    first ? setLoading(true) : setLoadingMore(true)
    fetch(`/api/orders?page=${nextPage}&limit=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error)
          return
        }
        setOrders((prev) => (first ? data.orders : [...prev, ...data.orders]))
        setHasMore(Boolean(data.hasMore))
        setTotal(data.total || 0)
        setPage(nextPage)
        setError(null)
      })
      .catch(() => setError('Не удалось загрузить заказы'))
      .finally(() => {
        first ? setLoading(false) : setLoadingMore(false)
      })
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card className="md:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2>Заказы</h2>
        {total > 0 && <span className="text-sm text-muted">{total}</span>}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="alert alert-error">
          <svg className="ic ic-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
          <span>{error}</span>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <div className="ico">
            <svg className="ic" viewBox="0 0 24 24"><path d="M6 2l1.5 3M18 2l-1.5 3M3 6h18l-1.5 12.5a2 2 0 01-2 1.5H6.5a2 2 0 01-2-1.5z" /><path d="M9 11h6" /></svg>
          </div>
          <h3>Заказов пока нет</h3>
          <p>Здесь появятся ваши покупки — с составом, статусом и выданными ключами.</p>
          <Link href="/catalog" className="btn btn-primary mt-1">Перейти в каталог</Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
          {hasMore && (
            <button
              className="btn btn-secondary btn-block mt-4"
              data-loading={loadingMore ? 'true' : undefined}
              onClick={() => load(page + 1)}
              disabled={loadingMore}
            >
              Показать ещё
            </button>
          )}
        </>
      )}
    </Card>
  )
}

function OrderCard({ order }: { order: OrderRow }) {
  const itemCount = order.items.reduce((s, i) => s + (i.quantity || 1), 0)
  const hasKeys = order.items.some((i) => i.voucher_code)

  return (
    <Link
      href={`/orders/${order.id}`}
      className="block rounded-lg border border-border bg-white p-4 transition-colors hover:border-blue-200 focus:outline-none focus-visible:border-blue"
    >
      {/* Шапка: номер + дата + статус */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-navy">#{order.order_number}</div>
          <div className="text-[12.5px] text-muted-2 mt-0.5">
            {new Date(order.created_at).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
        <Badge variant={getStatusVariant(order.status)}>{getStatusLabel(order.status)}</Badge>
      </div>

      {/* Состав */}
      <div className="mt-3 space-y-1.5">
        {order.items.slice(0, 3).map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink truncate">
              {item.product_name}
              {item.quantity > 1 && <span className="text-muted-2"> × {item.quantity}</span>}
            </span>
            <span className="text-muted whitespace-nowrap">{formatPrice(item.price)}</span>
          </div>
        ))}
        {order.items.length > 3 && (
          <div className="text-[12.5px] text-muted-2">и ещё {order.items.length - 3}…</div>
        )}
      </div>

      {/* Низ: метаданные слева, сумма справа */}
      <div className="mt-3 pt-3 border-t border-border-2 flex items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge">{paymentLabel(order.payment_method)}</span>
          {order.promo?.code && <span className="badge badge-instant">Промокод {order.promo.code}</span>}
          {order.discount_amount > 0 && (
            <span className="badge badge-sale">−{formatPrice(order.discount_amount)}</span>
          )}
          {hasKeys && (
            <span className="badge badge-stock">
              <svg className="ic ic-sm" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8 2 2-2 2 2 2-3 3-2-2" /></svg>
              Ключи выданы
            </span>
          )}
        </div>
        <div className="text-right flex-none">
          <div className="text-[11px] text-muted-2 leading-none mb-0.5">{itemCount} поз.</div>
          <div className="text-lg font-extrabold text-navy leading-none">{formatPrice(order.final_amount)}</div>
        </div>
      </div>
    </Link>
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

function paymentLabel(method: string): string {
  switch (method) {
    case 'balance':
      return 'Баланс'
    case 'card':
      return 'Карта'
    case 'crypto':
      return 'Криптовалюта'
    default:
      return method
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'new':
      return 'Новый'
    case 'paid':
      return 'В обработке'
    case 'delivered':
      return 'Выполнен'
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
