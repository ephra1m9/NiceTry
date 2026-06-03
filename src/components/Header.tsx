'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/hooks/useUser'
import { useCart } from '@/hooks/useCart'
import { LEGAL_LINKS } from '@/components/Footer'

/**
 * Шапка сайта по эталону index.html:
 * верхняя промо-полоса, логотип, поиск с выбором раздела, чип баланса,
 * корзина со счётчиком, аккаунт с аватаром и нижняя навигация по категориям.
 * На узких экранах catnav/поиск-селект/баланс скрываются, появляется бургер,
 * открывающий выезжающее меню (drawer) с категориями и действиями аккаунта.
 */

// Пункты нижней навигации (иконки и подписи из index.html .catnav)
const CATNAV = [
  { label: 'Steam', icon: '<path d="M5 3h14v18l-7-4-7 4z"/>', href: '/catalog' },
  { label: 'Mobile-игры', icon: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/>', href: '/catalog' },
  { label: 'Пополнения', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>', href: '/catalog' },
  { label: 'Подписки', icon: '<path d="M4 7h16v12H4zM4 7l8 6 8-6"/>', href: '/catalog' },
  { label: 'Gift-карты', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M12 5v14"/>', href: '/catalog' },
  { label: 'Популярное', icon: '<path d="M12 3l2.5 5 5.5.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.5-.8z"/>', href: '/catalog' },
]

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
  const [topbar, setTopbar] = useState(true)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
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

  const go = (href: string) => {
    setMenuOpen(false)
    router.push(href)
  }

  return (
    <>
      {/* Верхняя промо-полоса */}
      {topbar && (
        <div className="topbar">
          <div className="container">
            <svg className="ic tg" viewBox="0 0 24 24">
              <path d="M21 4L3 11l5 2 2 6 3-4 5 4z" />
            </svg>
            <span>Новые дропы ключей и промокоды каждый день —</span>
            <Link href="/catalog">подпишись на Telegram-канал NiceTry</Link>
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

            {/* Поиск */}
            <form className="search" onSubmit={submitSearch} role="search">
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
                placeholder="Поиск: Steam, PUBG Mobile, V-Bucks, Roblox…"
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
            <Link className="hot" href="/catalog">
              <svg className="ic" viewBox="0 0 24 24">
                <path d="M12 3c1 3-2 4-2 7a4 4 0 008 0c0-2-1-3-1-3 2 1 3 3 3 6a8 8 0 01-16 0c0-4 3-6 4-8 1 2 2 1 4-2z" />
              </svg>
              Скидки
            </Link>
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
              <button onClick={() => go('/catalog')} style={{ color: 'var(--red)' }}>
                <svg className="ic" viewBox="0 0 24 24"><path d="M12 3c1 3-2 4-2 7a4 4 0 008 0c0-2-1-3-1-3 2 1 3 3 3 6a8 8 0 01-16 0c0-4 3-6 4-8 1 2 2 1 4-2z" /></svg>
                Скидки
              </button>

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
    </>
  )
}
