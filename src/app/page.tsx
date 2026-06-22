'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Product, Category } from '@/types'
import { PCard } from '@/components/PCard'
import { formatProductTitle } from '@/lib/utils'

/**
 * Главная страница — витрина по эталону index.html (#view-home):
 * промо-баннеры, плитки категорий, секции «Популярное / Новинки / Пополнения и валюта».
 *
 * Данные тянутся из существующих API (/api/categories, /api/products), у которых есть
 * фолбэк-каталог — поэтому витрина наполнена даже без боевых ключей поставщиков.
 */

// Иконки категорий (пути SVG из index.html CATS), подбор по названию
function categoryIconPaths(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('пополнен')) return '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'
  if (n.includes('валют'))
    return '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h3.5a1.5 1.5 0 010 3H9.5"/>'
  if (n.includes('ключ'))
    return '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8 2 2-2 2 2 2-3 3-2-2"/>'
  if (n.includes('подписк')) return '<path d="M4 7h16v12H4zM4 7l8 6 8-6"/>'
  if (n.includes('gift') || n.includes('гифт') || n.includes('карт'))
    return '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M12 6v13"/>'
  if (n.includes('аккаунт')) return '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0114 0"/>'
  return '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16"/>'
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

export default function HomePage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [banners, setBanners] = useState<Array<{ id: string; title: string; image_url: string; link_url?: string }>>([])
  const [sendGameEnabled, setSendGameEnabled] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []))
      .catch((err) => console.error('Failed to load categories:', err))
  }, [])

  useEffect(() => {
    fetch('/api/products?limit=200')
      .then((res) => res.json())
      .then((data) => setProducts(data.products || []))
      .catch((err) => console.error('Failed to load products:', err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/banners')
      .then(res => res.json())
      .then(data => setBanners(data.banners || []))
      .catch(() => {})
  }, [])

  // Видимость карточки «Отправь игру в стим» — управляется из админки (категории Dessly).
  useEffect(() => {
    fetch('/api/dessly/config')
      .then((r) => r.json())
      .then((c) => setSendGameEnabled(c.enabled !== false))
      .catch(() => {})
  }, [])

  // Кол-во товаров по категории (из загруженного списка)
  const countByCategory = (categoryId: string) =>
    products.filter((p) => p.category_id === categoryId).length

  const popular = products.slice(0, 5)
  const newItems = products.slice(5, 10)
  const topup = products
    .filter((p) => p.type === 'topup_auto' || p.type === 'topup_manual')
    .slice(0, 5)

  const renderSection = (title: string, list: Product[], linkText: string) =>
    list.length > 0 && (
      <section style={{ marginBottom: 30 }}>
        <div className="section-head">
          <h2>{title}</h2>
          <Link className="link" href="/catalog">
            {linkText}
          </Link>
        </div>
        <div className="prod-grid">
          {list.map((p) => (
            <PCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    )

  return (
    <div className="container py-8">
      {/* Промо-баннеры: динамические (из БД) или статический фолбэк */}
      {banners.length > 0 ? (
        <div className="promo-carousel" style={{ display: 'flex', gap: 16, overflowX: 'auto', scrollSnapType: 'x mandatory', marginBottom: 30, paddingBottom: 8 }}>
          {banners.map(b => {
            const inner = (
              <div key={b.id} className="promo main" style={{ minWidth: 'min(85vw, 700px)', scrollSnapAlign: 'start', backgroundImage: `url(${b.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(15,30,60,.92) 40%, transparent)', borderRadius: 'inherit' }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <h2>{b.title}</h2>
                </div>
              </div>
            )
            return b.link_url ? <a key={b.id} href={b.link_url} style={{ textDecoration: 'none' }}>{inner}</a> : inner
          })}
        </div>
      ) : (
        <div className="promo-grid">
          <div className="promo-split">
            {/* Левая половина: пополнение Steam-кошелька */}
            <div className="promo main">
              <div className="deco" />
              <span
                className="badge"
                style={{ background: 'rgba(255,255,255,.15)', color: '#cfe7fb', width: 'max-content', marginBottom: 10 }}
              >
                Steam · комиссия всего 3%
              </span>
              <h2>Пополни Steam-кошелёк</h2>
              <p>Мгновенное зачисление по честному курсу. Комиссия всего 3%, поддержка 24/7.</p>
              <Link className="btn btn-primary btn-lg" href="/steam">
                Пополнить Steam
              </Link>
            </div>
            {/* Правая половина: покупка прокси (открывает окно покупки из шапки) */}
            <div className="promo cards">
              <div className="deco" />
              <span
                className="badge"
                style={{ background: 'rgba(255,255,255,.15)', color: '#dfe6ff', width: 'max-content', marginBottom: 10 }}
              >
                IPv4 / IPv6 · любая страна
              </span>
              <h2>Купи прокси за секунды</h2>
              <p>HTTP(S) и SOCKS5 прокси под любую задачу — автоматическая выдача сразу после оплаты.</p>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => window.dispatchEvent(new CustomEvent('nt:open-proxy'))}
              >
                Купить прокси
              </button>
            </div>
          </div>
          <div className="promo side">
            <span className="tag">
              <svg className="ic ic-sm" viewBox="0 0 24 24">
                <path d="M21 4L3 11l5 2 2 6 3-4 5 4z" />
              </svg>
              TELEGRAM
            </span>
            <h3>TG Stars и Premium</h3>
            <p style={{ maxWidth: '100%' }}>Звёзды и Premium-подписка Telegram — оплата с баланса, отправка получателю за пару часов.</p>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => window.dispatchEvent(new CustomEvent('nt:open-telegram'))}
            >
              Купить
            </button>
          </div>
        </div>
      )}

      {/* Точка входа «Отправь игру в стим» (Dessly) — фирменный светлый бело-синий стиль NiceTry.
          Это только обёртка/триггер; сам флоу открывается на /send-game.
          Видимость управляется из админки (активность категорий Dessly). */}
      {sendGameEnabled && (
      <Link href="/send-game" className="send-game-card">
        <div className="sgc-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden>
            <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
          </svg>
        </div>
        <div className="sgc-text">
          <div className="sgc-title">Отправь игру в Steam</div>
          <div className="sgc-sub">Подари игру по ссылке-приглашению — издание, регион и расчёт за пару кликов.</div>
        </div>
        <span className="btn btn-primary sgc-cta">Отправить</span>
      </Link>
      )}

      {/* Плитки категорий */}
      {categories.length > 0 && (
        <div className="cat-tiles">
          {categories.map((cat) => {
            const count = countByCategory(cat.id)
            return (
              <div key={cat.id} className="cat-tile" onClick={() => router.push(`/category/${cat.slug}`)}>
                <div className="ico">
                  {cat.icon && (cat.icon.startsWith('/') || cat.icon.startsWith('http')) ? (
                    <img src={cat.icon} alt="" className="w-6 h-6 object-contain" />
                  ) : (
                    <svg
                      className="ic"
                      viewBox="0 0 24 24"
                      dangerouslySetInnerHTML={{ __html: categoryIconPaths(cat.name) }}
                    />
                  )}
                </div>
                <div className="nm">{formatProductTitle(cat.name)}</div>
                <div className="ct">
                  {count > 0
                    ? `${count} ${plural(count, ['товар', 'товара', 'товаров'])}`
                    : 'смотреть'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Секции товаров */}
      {loading ? (
        <section style={{ marginBottom: 30 }}>
          <div className="section-head">
            <h2>Популярное</h2>
          </div>
          <div className="prod-grid">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="scard">
                <div className="cover" />
                <div className="ln" style={{ width: '70%' }} />
                <div className="ln" style={{ width: '40%', marginBottom: 14 }} />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {renderSection('Популярное', popular, 'Весь каталог →')}
          {renderSection('Новинки', newItems, 'Смотреть все →')}
          {renderSection('Пополнения и валюта', topup, 'Смотреть все →')}
        </>
      )}
    </div>
  )
}
