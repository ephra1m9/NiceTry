'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/hooks/useUser'
import { useCart } from '@/hooks/useCart'
import { useTelegram } from '@/hooks/useTelegram'
import { LEGAL_LINKS } from '@/components/Footer'
import ProxyPurchase from '@/components/ProxyPurchase'
import TelegramPurchase from '@/components/TelegramPurchase'
import { TELEGRAM_CHANNEL_URL, hasLink } from '@/lib/links'

/**
 * Шапка сайта по эталону index.html:
 * верхняя промо-полоса, логотип, поиск с выбором раздела, чип баланса,
 * корзина со счётчиком, аккаунт с аватаром и нижняя навигация по категориям.
 * На узких экранах catnav/поиск-селект/баланс скрываются, появляется бургер,
 * открывающий выезжающее меню (drawer) с категориями и действиями аккаунта.
 */

// Пункты нижней навигации (иконки и подписи из index.html .catnav).
// href ведёт на каталог с группой (?group=…) — slug'и из src/lib/catalog-groups.ts.
const CATNAV = [
  { label: 'Steam', icon: '<path d="M5 3h14v18l-7-4-7 4z"/>', href: '/catalog?group=steam' },
  { label: 'Mobile-игры', icon: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/>', href: '/catalog?group=mobile' },
  { label: 'Пополнения', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>', href: '/catalog?group=topup' },
  { label: 'Подписки', icon: '<path d="M4 7h16v12H4zM4 7l8 6 8-6"/>', href: '/catalog?group=subscriptions' },
  { label: 'Gift-карты', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M12 5v14"/>', href: '/catalog?group=gift-cards' },
  { label: 'eSIM', icon: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7h3M9 11h6M9 15h6"/>', href: '/esim' },
  { label: 'Популярное', icon: '<path d="M12 3l2.5 5 5.5.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.5-.8z"/>', href: '/catalog?group=popular' },
]

// Иконка категории «Купить прокси» (глобус) — открывает окно покупки, а не ссылку.
const PROXY_ICON = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>'

// Иконка Telegram Stars/Premium (самолётик) — открывает окно покупки, а не ссылку.
const TELEGRAM_ICON = '<path d="M21 4L3 11l5 2 2 6 3-4 5 4z"/>'

function initials(email?: string): string {
  if (!email) return 'NT'
  const name = email.split('@')[0]
  return name.slice(0, 2).toUpperCase()
}

export default function Header() {
  const router = useRouter()
  const { user: authUser, signOut } = useAuth()
  const { user } = useUser()
  const { totalItems } = useCart()
  const { isTelegram } = useTelegram()
  const [topbar, setTopbar] = useState(true)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Окно покупки прокси (открывается из catnav/drawer). proxyEnabled — флаг из админки:
  // пункт показываем только когда покупка прокси включена (proxy_settings.is_enabled).
  const [proxyOpen, setProxyOpen] = useState(false)
  const [proxyEnabled, setProxyEnabled] = useState(false)
  // Окно покупки Telegram Stars/Premium (открывается из главной/событием nt:open-telegram).
  const [telegramOpen, setTelegramOpen] = useState(false)

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchOpen(false)
    router.push(search.trim() ? `/catalog?search=${encodeURIComponent(search.trim())}` : '/catalog')
  }

  // Блокируем прокрутку фона, пока открыт drawer; закрываем по Esc
  useEffect(() => {
    if (!menuOpen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Узнаём, включена ли покупка прокси (proxy_settings.is_enabled) — иначе пункт скрыт.
  useEffect(() => {
    fetch('/api/proxy/config')
      .then((r) => r.json())
      .then((c) => setProxyEnabled(c?.enabled === true))
      .catch(() => {})
  }, [])

  // Блокируем фон и вешаем Esc, пока открыто окно покупки прокси.
  useEffect(() => {
    if (!proxyOpen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setProxyOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [proxyOpen])

  // Открыть окно покупки прокси (и закрыть drawer, если открыт).
  const openProxy = () => {
    setMenuOpen(false)
    setProxyOpen(true)
  }

  // Внешний триггер открытия окна покупки прокси (например, плашка на главной).
  useEffect(() => {
    const onOpenProxy = () => {
      if (proxyEnabled) openProxy()
    }
    window.addEventListener('nt:open-proxy', onOpenProxy)
    return () => window.removeEventListener('nt:open-proxy', onOpenProxy)
  }, [proxyEnabled])

  // Блокируем фон и вешаем Esc, пока открыто окно покупки Telegram Stars/Premium.
  useEffect(() => {
    if (!telegramOpen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTelegramOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [telegramOpen])

  // Открыть окно покупки Telegram Stars/Premium (и закрыть drawer, если открыт).
  const openTelegram = () => {
    setMenuOpen(false)
    setTelegramOpen(true)
  }

  // Внешний триггер открытия окна покупки Telegram Stars/Premium (плашка на главной).
  useEffect(() => {
    const onOpenTelegram = () => openTelegram()
    window.addEventListener('nt:open-telegram', onOpenTelegram)
    return () => window.removeEventListener('nt:open-telegram', onOpenTelegram)
  }, [])

  const go = (href: string) => {
    setMenuOpen(false)
    router.push(href)
  }

  return (
    <>
      {/* Шапка Telegram Mini App: сайтовая шапка в Mini App скрыта (CSS .site-header),
          поэтому рисуем отдельную компактную — логотип, поиск и доступ к меню/категориям.
          Учитываем safe-area сверху (чёлка Telegram). Видна в Mini App.
          На обычном узком экране иконка-поиска есть в header-actions — дублировать не нужно. */}
      {isTelegram && (
        <div className="tg-header">
          <button
            className="tg-header-menu"
            aria-label="Меню"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <svg className="ic" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <Link className="tg-header-logo" href="/" aria-label="NiceTry">
            <svg viewBox="0 0 250 56" xmlns="http://www.w3.org/2000/svg">
              <text x="0" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#1C8CE3">N</text>
              <text x="30" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#0F1E2E">T</text>
              <text x="72" y="31" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#1C8CE3">Nice</text>
              <text x="118" y="50" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#0F1E2E">try</text>
            </svg>
          </Link>
          <Link className="tg-header-acct" href="/profile" aria-label="Профиль">
            <span className="av">{authUser ? initials(authUser.email ?? user?.email) : 'NT'}</span>
          </Link>
          <form className="tg-header-search" onSubmit={submitSearch} role="search">
            <svg className="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></svg>
            <input
              type="text"
              aria-label="Поиск по каталогу"
              placeholder="Поиск: Steam, PUBG, V-Bucks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        </div>
      )}

      {/* Верхняя промо-полоса */}
      {topbar && (
        <div className="topbar">
          <div className="container">
            <svg className="ic tg" viewBox="0 0 24 24">
              <path d="M21 4L3 11l5 2 2 6 3-4 5 4z" />
            </svg>
            <span>Новые дропы ключей и промокоды каждый день —</span>
            {/* Ссылка на Telegram-канал из env (NEXT_PUBLIC_TELEGRAM_CHANNEL_URL);
                пока не задана — ведём в каталог, чтобы полоса оставалась кликабельной. */}
            {hasLink(TELEGRAM_CHANNEL_URL) ? (
              <a href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
                подпишись на Telegram-канал NiceTry
              </a>
            ) : (
              <Link href="/catalog">подпишись на Telegram-канал NiceTry</Link>
            )}
            <button className="close" aria-label="Закрыть" onClick={() => setTopbar(false)}>
              <svg className="ic ic-sm" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <header className="site site-header">
        <div className="container">
          <div className="header-main">
            <button
              className="iconbtn burger"
              aria-label="Открыть меню"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <svg className="ic" viewBox="0 0 24 24">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <Link className="logo" href="/" aria-label="NiceTry">
              <svg viewBox="0 0 250 56" xmlns="http://www.w3.org/2000/svg">
                <text x="0" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#1C8CE3">N</text>
                <text x="30" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#0F1E2E">T</text>
                <text x="72" y="31" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#1C8CE3">Nice</text>
                <text x="118" y="50" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#0F1E2E">try</text>
              </svg>
            </Link>

            {/* Поиск (десктоп: всегда виден; мобильный: показывается по клику на иконку-лупу) */}
            <form className={`search ${searchOpen ? 'search--open' : ''}`.trim()} onSubmit={submitSearch} role="search">
              <select className="cat" aria-label="Раздел" defaultValue="">
                <option value="">Все разделы</option>
                <option>Игровая валюта</option>
                <option>Ключи игр</option>
                <option>Пополнения</option>
                <option>Подписки</option>
                <option>Gift-карты</option>
              </select>
              <input
                type="text"
                aria-label="Поиск по каталогу"
                placeholder="Поиск: Steam, PUBG, V-Bucks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="go" type="submit" aria-label="Найти">
                <svg className="ic" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.2-3.2" />
                </svg>
              </button>
            </form>

            {/* Действия */}
            <div className="header-actions">
              {/* Иконка поиска на мобильных — раскрывает строку поиска */}
              <button
                className="iconbtn search-toggle-btn"
                aria-label="Поиск"
                onClick={() => setSearchOpen((v) => !v)}
                type="button"
              >
                <svg className="ic" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.2-3.2" />
                </svg>
              </button>
              {authUser && (
                <Link className="balance-chip" href="/profile" title="Баланс">
                  <svg className="ic" viewBox="0 0 24 24">
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                    <path d="M3 10h18" />
                  </svg>
                  <span className="bval">
                    {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(user?.balance ?? 0)} ₽
                  </span>
                </Link>
              )}

              <button className="iconbtn cart-btn" aria-label="Корзина" onClick={() => router.push('/cart')}>
                <svg className="ic" viewBox="0 0 24 24">
                  <circle cx="9" cy="20" r="1.4" />
                  <circle cx="18" cy="20" r="1.4" />
                  <path d="M2 3h3l2.4 12.4a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 7H6" />
                </svg>
                {totalItems > 0 && <span className="count">{totalItems}</span>}
              </button>

              {authUser ? (
                <Link className="acct" href="/profile">
                  <span className="av">{initials(authUser.email ?? user?.email)}</span>
                  <span className="nm small" style={{ fontWeight: 600 }}>
                    Профиль
                  </span>
                </Link>
              ) : (
                <Link className="btn btn-primary" href="/auth/login">
                  Войти
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Навигация по категориям */}
        <nav className="catnav">
          <div className="container">
            <Link className="allcats" href="/catalog">
              <svg className="ic" viewBox="0 0 24 24">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Все категории
            </Link>
            {CATNAV.map((item) => (
              <Link key={item.label} href={item.href}>
                <svg className="ic" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
                {item.label}
              </Link>
            ))}
            {user?.is_admin && (
              <Link href="/admin" style={{ marginLeft: 'auto', color: 'var(--blue-700)' }}>
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
                </svg>
                Админ-панель
              </Link>
            )}
            {authUser && (
              <button
                onClick={signOut}
                style={{ background: 'none', border: 0, cursor: 'pointer', marginLeft: user?.is_admin ? undefined : 'auto' }}
                title="Выйти"
                aria-label="Выйти"
              >
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                </svg>
              </button>
            )}
          </div>
        </nav>
      </header>

      {/* Мобильное выезжающее меню */}
      {menuOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Меню">
            <div className="drawer-head">
              <Link className="logo" href="/" onClick={() => setMenuOpen(false)} aria-label="NiceTry">
                <svg viewBox="0 0 250 56" style={{ height: 30 }} xmlns="http://www.w3.org/2000/svg">
                  <text x="0" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#1C8CE3">N</text>
                  <text x="30" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#0F1E2E">T</text>
                  <text x="72" y="31" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#1C8CE3">Nice</text>
                  <text x="118" y="50" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#0F1E2E">try</text>
                </svg>
              </Link>
              <button className="iconbtn" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}>
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {authUser && (
              <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="av" style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,var(--blue),var(--blue-800))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flex: 'none' }}>
                    {initials(authUser.email ?? user?.email)}
                  </span>
                  <span className="text-sm font-semibold text-navy truncate">{authUser.email ?? user?.email}</span>
                </div>
              </div>
            )}

            <nav className="drawer-nav">
              <button onClick={() => go('/catalog')}>
                <svg className="ic" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                Все категории
              </button>
              {CATNAV.map((item) => (
                <button key={item.label} onClick={() => go(item.href)}>
                  <svg className="ic" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
                  {item.label}
                </button>
              ))}
              <div className="drawer-sep" />

              {authUser ? (
                <>
                  <button onClick={() => go('/profile')}>
                    <svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></svg>
                    Профиль · {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(user?.balance ?? 0)} ₽
                  </button>
                  <button onClick={() => go('/cart')}>
                    <svg className="ic" viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 12.4a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 7H6" /></svg>
                    Корзина{totalItems > 0 ? ` · ${totalItems}` : ''}
                  </button>
                  {user?.is_admin && (
                    <button onClick={() => go('/admin')}>
                      <svg className="ic" viewBox="0 0 24 24"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg>
                      Админ-панель
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); signOut() }} style={{ color: 'var(--red)' }}>
                    <svg className="ic" viewBox="0 0 24 24"><path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /></svg>
                    Выйти
                  </button>
                </>
              ) : (
                <button onClick={() => go('/auth/login')}>
                  <svg className="ic" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
                  Войти / Регистрация
                </button>
              )}

              <div className="drawer-sep" />

              {LEGAL_LINKS.map((link) => (
                <button key={link.href} onClick={() => go(link.href)}>
                  <svg className="ic" viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7zM14 3v5h5" /></svg>
                  {link.label}
                </button>
              ))}
            </nav>
          </div>
        </>
      )}

      {/* Окно покупки прокси — открывается из catnav (десктоп) и из верха drawer (мобайл). */}
      {proxyOpen && (
        <div
          className="proxy-modal-overlay"
          onClick={() => setProxyOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Купить прокси"
        >
          <div className="proxy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="proxy-modal-head">
              <div className="proxy-modal-title">
                <svg className="ic" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: PROXY_ICON }} />
                Купить прокси
              </div>
              <button className="iconbtn" aria-label="Закрыть" onClick={() => setProxyOpen(false)}>
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="proxy-modal-body">
              <ProxyPurchase embedded />
            </div>
          </div>
        </div>
      )}

      {/* Окно покупки Telegram Stars/Premium — открывается с главной и по событию nt:open-telegram. */}
      {telegramOpen && (
        <div
          className="proxy-modal-overlay"
          onClick={() => setTelegramOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Купить Telegram Stars или Premium"
        >
          <div className="proxy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="proxy-modal-head">
              <div className="proxy-modal-title">
                <svg className="ic" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: TELEGRAM_ICON }} />
                Telegram Stars и Premium
              </div>
              <button className="iconbtn" aria-label="Закрыть" onClick={() => setTelegramOpen(false)}>
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="proxy-modal-body">
              <TelegramPurchase embedded />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
