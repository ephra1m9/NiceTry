'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

/**
 * Раздел «Мои eSIM» в профиле (сайт + Mini App).
 * Купленные eSIM из /api/dessly/esim/orders: страна, тариф, статус выдачи, активация.
 * Сортировка от новых к старым, пагинация «Показать ещё».
 */

interface EsimOrderRow {
  id: string
  order_number: string
  status: string
  final_amount: number
  created_at: string
  country: string | null
  plan_label: string | null
  delivery_status: 'pending' | 'delivered' | 'failed' | string
  voucher_code: string | null
}

const PAGE_SIZE = 5

let regionNames: Intl.DisplayNames | null = null
try {
  regionNames = new Intl.DisplayNames(['ru'], { type: 'region' })
} catch {
  regionNames = null
}

function countryLabel(country: string | null): string {
  if (!country) return 'Весь мир'
  if (country.length === 2) {
    try {
      return regionNames?.of(country) || country
    } catch {
      return country
    }
  }
  return country
}

function pluralDays(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? 'дня' : 'дней'
  return `${n} ${word}`
}

// Тариф приходит от Dessly на английском («20GB, 31 Day», «Unlimited, 7 Day(s)») — переводим
// по тем же числовым полям, что и витрина /esim (ГБ/срок), а не показываем исходный текст.
function planLabel(raw: string | null): string {
  if (!raw) return ''
  const days = raw.match(/(\d+)\s*Days?/i)
  if (/unlimited/i.test(raw)) {
    return days ? `Безлимит, ${pluralDays(Number(days[1]))}` : 'Безлимит'
  }
  const gb = raw.match(/(\d+(?:\.\d+)?)\s*GB/i)
  const parts: string[] = []
  if (gb) parts.push(`${gb[1]} ГБ`)
  if (days) parts.push(pluralDays(Number(days[1])))
  return parts.length ? parts.join(', ') : raw
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Поставщик обрабатывает выдачу',
  delivered: 'Активирована',
  failed: 'Не выдана, средства возвращены',
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'badge-amber',
  delivered: 'badge-stock',
  failed: 'badge-out',
}

export default function EsimOrdersSection() {
  const [orders, setOrders] = useState<EsimOrderRow[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (nextPage: number) => {
    const first = nextPage === 1
    first ? setLoading(true) : setLoadingMore(true)
    fetch(`/api/dessly/esim/orders?page=${nextPage}&limit=${PAGE_SIZE}`)
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
      .catch(() => setError('Не удалось загрузить eSIM'))
      .finally(() => {
        first ? setLoading(false) : setLoadingMore(false)
      })
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Не показываем раздел совсем, если у пользователя нет купленных eSIM (чтобы не плодить пустоту).
  if (!loading && !error && orders.length === 0) return null

  return (
    <Card className="md:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2>Мои eSIM</h2>
        {total > 0 && <span className="text-sm text-muted">{total}</span>}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="alert alert-error">
          <svg className="ic ic-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
          <span>{error}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {orders.map((order) => (
              <EsimOrderCard key={order.id} order={order} />
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

function EsimOrderCard({ order }: { order: EsimOrderRow }) {
  const [copied, setCopied] = useState(false)

  const copyActivation = () => {
    if (!order.voucher_code) return
    navigator.clipboard.writeText(order.voucher_code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-navy">{countryLabel(order.country)}</span>
            {planLabel(order.plan_label) && <span className="text-muted">{planLabel(order.plan_label)}</span>}
          </div>
          <div className="text-[12.5px] text-muted-2 mt-1">
            #{order.order_number} · {Number(order.final_amount).toFixed(0)} ₽ ·{' '}
            {new Date(order.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </div>
        </div>
        <Badge variant={order.delivery_status === 'delivered' ? 'stock' : order.delivery_status === 'failed' ? 'out' : 'amber'}>
          {STATUS_LABELS[order.delivery_status] || order.delivery_status}
        </Badge>
      </div>

      {order.delivery_status === 'delivered' && order.voucher_code ? (
        <div className="mt-3 pt-3 border-t border-border-2">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[12.5px] text-muted-2">Данные активации</span>
            <button className="btn btn-ghost btn-sm" onClick={copyActivation}>
              {copied ? '✓ Скопировано' : 'Копировать'}
            </button>
          </div>
          <pre className="text-[13px] whitespace-pre-wrap bg-blue-50/40 rounded-md p-2.5 m-0 break-all">
            {order.voucher_code}
          </pre>
        </div>
      ) : order.delivery_status === 'pending' ? (
        <div className="mt-3 pt-3 border-t border-border-2">
          <Link href={`/orders/${order.id}#chat`} className="text-sm text-blue-700">
            Следить за выдачей в чате заказа
          </Link>
        </div>
      ) : null}
    </div>
  )
}
