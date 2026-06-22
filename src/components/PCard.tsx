'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Product } from '@/types'
import { useCart } from '@/hooks/useCart'
import { formatProductTitle } from '@/lib/utils'

/**
 * Карточка товара в стиле эталона index.html (.pcard):
 * градиентная обложка с платформой/названием, рейтинг, бейджи, цена и кнопка «в корзину».
 *
 * Обложка/платформа подбираются по названию товара (для тематического вида),
 * с детерминированным фолбэком по хэшу id — чтобы вид был стабильным между рендерами.
 */

// Палитра обложек (COVERS из index.html)
const COVER_GRADIENTS: Record<string, string> = {
  steam: 'linear-gradient(135deg,#1b2838,#2a475e)',
  pubg: 'linear-gradient(135deg,#b8431a,#e8932f)',
  fortnite: 'linear-gradient(135deg,#2b1b6e,#5a3df0)',
  roblox: 'linear-gradient(135deg,#363b40,#10202c)',
  genshin: 'linear-gradient(135deg,#1f6f8b,#34c0c9)',
  brawl: 'linear-gradient(135deg,#7a1fb0,#d23bd2)',
  discord: 'linear-gradient(135deg,#4453c4,#5865F2)',
  gift: 'linear-gradient(135deg,#0F62A8,#1C8CE3)',
  mlbb: 'linear-gradient(135deg,#143a8a,#2d7bd6)',
  valorant: 'linear-gradient(135deg,#b3203a,#ff4655)',
  xbox: 'linear-gradient(135deg,#107C10,#0e6b0e)',
}
const COVER_KEYS = Object.keys(COVER_GRADIENTS)

const TYPE_LABEL: Record<string, string> = {
  instant: 'Моментально',
  topup_auto: 'Пополнение · авто',
  topup_manual: 'Пополнение · менеджер',
  manual: 'Ручная выдача',
}

// Детект платформы по названию — для подбора обложки и подписи
function detectPlatform(name: string): string | null {
  const n = name.toLowerCase()
  if (n.includes('steam')) return 'steam'
  if (n.includes('pubg')) return 'pubg'
  if (n.includes('fortnite')) return 'fortnite'
  if (n.includes('roblox')) return 'roblox'
  if (n.includes('genshin')) return 'genshin'
  if (n.includes('brawl')) return 'brawl'
  if (n.includes('discord')) return 'discord'
  if (n.includes('mobile legends') || n.includes('mlbb')) return 'mlbb'
  if (n.includes('valorant')) return 'valorant'
  if (n.includes('xbox')) return 'xbox'
  if (n.includes('gift')) return 'gift'
  return null
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value)
}

export function PCard({ product }: { product: Product }) {
  const { addToCart } = useCart()
  const router = useRouter()

  const key = product.id || product.name
  const h = hash(key)

  const platform = detectPlatform(product.name)
  const gradient = platform
    ? COVER_GRADIENTS[platform]
    : COVER_GRADIENTS[COVER_KEYS[h % COVER_KEYS.length]]
  // Реальная обложка от поставщика (product.image_url) кладётся фоном поверх градиента.
  // Если ссылка битая/не загрузилась — снизу остаётся брендовый градиент (картинка «обязательна»:
  // визуал есть всегда), а тёмный скрим .cover::after держит читаемость названия.
  const cover = product.image_url
    ? `url("${product.image_url}") center / cover no-repeat, ${gradient}`
    : gradient
  const plat = (platform ?? product.category?.name ?? 'NiceTry').toUpperCase()
  const displayName = formatProductTitle(product.name)
  const ttl = displayName.split(' — ')[0]

  const isTopup = product.type === 'topup_auto' || product.type === 'topup_manual'
  const inStock = !(product.type === 'instant' && product.stock != null && product.stock <= 0)
  const hasDiscount = !!product.original_price && product.original_price > product.price
  const discount = hasDiscount
    ? Math.round((1 - product.price / product.original_price!) * 100)
    : 0

  // TODO(динамика): рейтинг и продажи — детерминированные плейсхолдеры
  // до подвязки реальных метрик из БД (отдельный этап «динамические данные»).
  const rating = (4.5 + (h % 5) / 10).toFixed(1)
  const sales = 200 + (h % 8000)
  const hot = !hasDiscount && sales > 4000

  const href = `/product/${product.id}`

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!inStock) return
    addToCart({ product, quantity: 1 })
  }

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className={`pcard${inStock ? '' : ' out'}`}>
      {/* Обложка */}
      <div
        className="cover"
        style={{ background: cover }}
        onClick={() => router.push(href)}
        role="link"
        aria-label={displayName}
      >
        <div className="topbadges">
          {hot ? (
            <span className="badge badge-sale">Хит</span>
          ) : hasDiscount ? (
            <span className="badge badge-sale">Скидка</span>
          ) : (
            <span />
          )}
          <button className="fav" aria-label="В избранное" onClick={stop}>
            <svg className="ic ic-sm" viewBox="0 0 24 24">
              <path d="M12 21C5 14 3 9 6 6c2-2 5-1 6 1 1-2 4-3 6-1 3 3 1 8-6 15z" />
            </svg>
          </button>
        </div>
        <div>
          <div className="plat">{plat}</div>
          <div className="ttl">{ttl}</div>
        </div>
      </div>

      {/* Тело */}
      <div className="body">
        <Link href={href} className="nm">
          {displayName}
        </Link>

        <div className="meta">
          <span className="star">
            <svg width="13" height="13" fill="#E8A33D" viewBox="0 0 24 24">
              <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
            </svg>
            {rating}
          </span>
          <span>{sales.toLocaleString('ru-RU').replace(/,/g, ' ')} прод.</span>
        </div>

        <div className="badges">
          {product.type === 'instant' ? (
            <span className="badge badge-instant">Моментально</span>
          ) : (
            <span className="badge">{TYPE_LABEL[product.type] ?? 'Товар'}</span>
          )}
          {hasDiscount && <span className="badge badge-sale">−{discount}%</span>}
          {inStock ? (
            <span className="badge badge-stock">
              <span className="dot" />В наличии
            </span>
          ) : (
            <span className="badge badge-out">Нет в наличии</span>
          )}
        </div>

        <div className="foot">
          <div className="price">
            {hasDiscount && <span className="old">{money(product.original_price!)}</span>}
            <span className="now">
              {isTopup && (
                <span style={{ fontSize: 12, color: 'var(--muted-2)', fontWeight: 400 }}>от </span>
              )}
              {money(product.price)}
            </span>
          </div>
          <button className="add" aria-label="В корзину" onClick={handleAdd}>
            <svg className="ic" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
