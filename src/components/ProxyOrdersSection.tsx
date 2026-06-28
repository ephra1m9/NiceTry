'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { BI } from '@/components/ui/BI'

/**
 * Раздел «Мои прокси» в профиле (сайт + Mini App).
 * Купленные прокси px6 из /api/proxy/orders: тип (версия), страна, кол-во, срок, дата окончания
 * и список выданных прокси ip:port:user:pass с копированием (по одному и «копировать все»).
 * Сортировка от новых к старым, пагинация «Показать ещё».
 */

interface ProxyEntry {
  id: string
  ip: string
  host: string
  port: string
  user: string
  pass: string
  type: string
  country: string
  date?: string
  dateEnd?: string
  date_end?: string
  active?: boolean
}

interface ProxyOrderRow {
  id: string
  version: number
  country: string
  count: number
  period: number
  proxy_type?: string | null
  price_internal: number
  proxies?: ProxyEntry[] | null
  status: string
  created_at: string
}

const VERSION_LABELS: Record<number, string> = {
  3: 'IPv4 Shared',
  4: 'IPv4',
  5: 'MTProto',
  6: 'IPv6',
}

const PAGE_SIZE = 5

function proxyLine(p: ProxyEntry): string {
  const host = p.host || p.ip
  return p.user ? `${host}:${p.port}:${p.user}:${p.pass}` : `${host}:${p.port}`
}

function endDate(p: ProxyEntry): string {
  return p.dateEnd || p.date_end || ''
}

export default function ProxyOrdersSection() {
  const [orders, setOrders] = useState<ProxyOrderRow[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (nextPage: number) => {
    const first = nextPage === 1
    first ? setLoading(true) : setLoadingMore(true)
    fetch(`/api/proxy/orders?page=${nextPage}&limit=${PAGE_SIZE}`)
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
      .catch(() => setError('Не удалось загрузить прокси'))
      .finally(() => {
        first ? setLoading(false) : setLoadingMore(false)
      })
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Не показываем раздел совсем, если у пользователя нет купленных прокси (чтобы не плодить пустоту).
  if (!loading && !error && orders.length === 0) return null

  return (
    <Card className="md:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2>Мои прокси</h2>
        {total > 0 && <span className="text-sm text-muted">{total}</span>}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="alert alert-error">
          <BI name="info-circle" size="sm" />
          <span>{error}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {orders.map((order) => (
              <ProxyOrderCard key={order.id} order={order} />
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

function ProxyOrderCard({ order }: { order: ProxyOrderRow }) {
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const proxies = order.proxies || []

  const copyAll = () => {
    const text = proxies.map(proxyLine).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1800)
    })
  }

  const copyOne = (p: ProxyEntry) => {
    navigator.clipboard.writeText(proxyLine(p)).then(() => {
      setCopiedId(p.id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      {/* Шапка: тип + страна + параметры */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-navy">{VERSION_LABELS[order.version] || `v${order.version}`}</span>
            <Badge variant="instant">{order.country.toUpperCase()}</Badge>
            {order.proxy_type && <span className="badge">{order.proxy_type.toUpperCase()}</span>}
          </div>
          <div className="text-[12.5px] text-muted-2 mt-1">
            {order.count} шт. · {order.period} дн. ·{' '}
            {new Date(order.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </div>
        </div>
        {proxies.length > 1 && (
          <button className="btn btn-secondary btn-sm" onClick={copyAll}>
            {copiedAll ? 'Скопировано' : 'Копировать все'}
          </button>
        )}
      </div>

      {/* Список прокси */}
      <div className="flex flex-col gap-2">
        {proxies.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 flex-wrap rounded-md border border-border-2 bg-blue-50/40 px-3 py-2"
          >
            <code className="font-mono text-[13px] text-navy break-all flex-1 min-w-[160px]">{proxyLine(p)}</code>
            {endDate(p) && <span className="text-[11.5px] text-muted whitespace-nowrap">до {endDate(p)}</span>}
            <button className="btn btn-ghost btn-sm flex-none" onClick={() => copyOne(p)}>
              {copiedId === p.id ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        ))}
        {proxies.length === 0 && (
          <div className="text-sm text-muted">Данные прокси недоступны.</div>
        )}
      </div>
    </div>
  )
}
