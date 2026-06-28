'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BI } from '@/components/ui/BI'

const MENU = [
  { href: '/admin', label: 'Dashboard', icon: 'grid' },
  { href: '/admin/products', label: 'Товары', icon: 'box-seam' },
  { href: '/admin/categories', label: 'Категории', icon: 'collection' },
  { href: '/admin/orders', label: 'Заказы', icon: 'cart3' },
  { href: '/admin/chats', label: 'Чаты', icon: 'chat-dots' },
  { href: '/admin/users', label: 'Пользователи', icon: 'people' },
  { href: '/admin/promo-codes', label: 'Промокоды', icon: 'ticket-perforated' },
  { href: '/admin/banners', label: 'Баннеры', icon: 'image' },
  { href: '/admin/utm', label: 'UTM', icon: 'bar-chart' },
  { href: '/admin/mailings', label: 'Рассылки', icon: 'envelope' },
  { href: '/admin/telegram-orders', label: 'TG Stars/Premium', icon: 'send' },
  { href: '/admin/settings', label: 'Настройки', icon: 'gear' },
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
          <BI name={item.icon} />
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
              <BI name="x-lg" />
            </button>
          </div>

          <NavLinks />

          <div className="mt-7 pt-5 border-t border-border">
            <Link
              href="/"
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium text-muted hover:bg-gray-bg transition-colors"
            >
              <BI name="house" />
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
            <BI name="list" />
          </button>
          <span className="font-bold text-navy">NiceTry <span className="text-muted-2 font-normal">· Админ</span></span>
        </div>

        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
