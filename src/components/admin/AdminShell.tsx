'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

// Иконки-штрихи пунктов меню (в стиле svg.ic эталона)
const ICONS: Record<string, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  products: <><path d="M21 16V8l-9-5-9 5v8l9 5z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" /></>,
  categories: <><path d="M3 7h18M3 12h18M3 17h18" /><rect x="3" y="3" width="4" height="4" rx="0.5" /><rect x="3" y="10" width="4" height="4" rx="0.5" /><rect x="3" y="17" width="4" height="4" rx="0.5" /></>,
  orders: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 12.4a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 7H6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0114 0M17 4a3.5 3.5 0 010 7M22 20a7 7 0 00-5-6.7" /></>,
  promo: <><path d="M3 9V6a2 2 0 012-2h14a2 2 0 012 2v3a2 2 0 000 6v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 000-6z" /><path d="M12 7v10" strokeDasharray="2 3" /></>,
  banners: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5-9 8" /></>,
  utm: <><path d="M4 19V5M4 19h16M8 16l3-4 3 2 4-6" /></>,
  mailings: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  telegram: <><path d="M21 4L3 11l5 2 2 6 3-4 5 4z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>,
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
}

const MENU = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/products', label: 'Товары', icon: 'products' },
  { href: '/admin/categories', label: 'Категории', icon: 'categories' },
  { href: '/admin/orders', label: 'Заказы', icon: 'orders' },
  { href: '/admin/users', label: 'Пользователи', icon: 'users' },
  { href: '/admin/promo-codes', label: 'Промокоды', icon: 'promo' },
  { href: '/admin/banners', label: 'Баннеры', icon: 'banners' },
  { href: '/admin/utm', label: 'UTM', icon: 'utm' },
  { href: '/admin/mailings', label: 'Рассылки', icon: 'mailings' },
  { href: '/admin/telegram-orders', label: 'TG Stars/Premium', icon: 'telegram' },
  { href: '/admin/settings', label: 'Настройки', icon: 'settings' },
]

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Закрываем меню при смене маршрута и блокируем фон, пока открыто
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href))

  const NavLinks = () => (
    <nav className="space-y-1">
      {MENU.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            isActive(item.href) ? 'bg-blue-50 text-blue-700' : 'text-muted hover:bg-blue-50 hover:text-blue-700'
          }`}
        >
          <svg className="ic" viewBox="0 0 24 24">{ICONS[item.icon]}</svg>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  )

  return (
    <div className="admin-shell bg-bg">
      {/* Сайдбар (на десктопе статичный, на мобиле — выезжает) */}
      <aside className={`admin-sidebar ${open ? 'open' : ''}`}>
        <div className="p-5">
          <div className="flex items-center justify-between mb-7">
            <Link href="/admin" className="flex items-center gap-2">
              <span className="text-xl font-bold text-navy">NiceTry</span>
              <span className="badge badge-amber !h-5 !text-[10px]">ADMIN</span>
            </Link>
            <button className="iconbtn !w-9 !h-9 lg:hidden" aria-label="Закрыть меню" onClick={() => setOpen(false)}>
              <svg className="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          <NavLinks />

          <div className="mt-7 pt-5 border-t border-border">
            <Link
              href="/"
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium text-muted hover:bg-gray-bg transition-colors"
            >
              <svg className="ic" viewBox="0 0 24 24">{ICONS.home}</svg>
              <span>На сайт</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Затемнение под выехавшим меню */}
      {open && <div className="drawer-overlay lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      {/* Контент */}
      <div className="admin-content">
        {/* Мобильная верхняя панель с бургером */}
        <div className="admin-topbar">
          <button className="iconbtn !w-10 !h-10" aria-label="Открыть меню" onClick={() => setOpen(true)}>
            <svg className="ic" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <span className="font-bold text-navy">NiceTry <span className="text-muted-2 font-normal">· Админ</span></span>
        </div>

        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
