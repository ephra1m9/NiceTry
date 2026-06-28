'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import { BI } from '@/components/ui/BI'

/**
 * Раздел «Мои Telegram-заявки» в профиле (сайт + Mini App).
 * Заявки на Stars/Premium из /api/telegram/orders: пакет, получатель, цена, статус.
 * Выдача автоматическая через AppRoute и обычно завершается за секунды (completed);
 * pending значит «поставщик ещё обрабатывает», встречается редко.
 * Сортировка от новых к старым, пагинация «Показать ещё».
 */

interface TelegramOrderRow {
  id: string
  product_type: 'stars' | 'premium'
  amount: number
  recipient_username: string
  price_rub: number
  status: 'pending' | 'completed' | 'failed'
  created_at: string
}

const STATUS_LABELS: Record<TelegramOrderRow['status'], string> = {
  pending: 'В обработке',
  completed: 'Выдано',
  failed: 'Отменено, средства возвращены',
}

const STATUS_CLASS: Record<TelegramOrderRow['status'], string> = {
  pending: 'badge-amber',
  completed: 'badge-stock',
  failed: 'badge-out',
}

const PAGE_SIZE = 5

function packageLabel(o: TelegramOrderRow): string {
  return o.product_type === 'stars' ? `${o.amount} звёзд` : `Premium на ${o.amount} мес.`
}

export default function TelegramOrdersSection() {
  const [orders, setOrders] = useState<TelegramOrderRow[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (nextPage: number) => {
    const first = nextPage === 1
    first ? setLoading(true) : setLoadingMore(true)
    fetch(`/api/telegram/orders?page=${nextPage}&limit=${PAGE_SIZE}`)
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
      .catch(() => setError('Не удалось загрузить заявки'))
      .finally(() => {
        first ? setLoading(false) : setLoadingMore(false)
      })
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Не показываем раздел совсем, если у пользователя нет заявок (чтобы не плодить пустоту).
  if (!loading && !error && orders.length === 0) return null

  return (
    <Card className="md:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2>Мои Telegram-заявки</h2>
        {total > 0 && <span className="text-sm text-muted">{total}</span>}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="alert alert-error">
          <BI name="info-circle" size="sm" />
          <span>{error}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-border bg-white p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-navy">{packageLabel(order)}</span>
                    <span className={`badge ${STATUS_CLASS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
                  </div>
                  <div className="text-[12.5px] text-muted-2 mt-1">
                    для @{order.recipient_username} · {Number(order.price_rub).toFixed(0)} ₽ ·{' '}
                    {new Date(order.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </div>
                </div>
              </div>
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
