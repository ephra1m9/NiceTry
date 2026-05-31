import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Проверка прав администратора
  const { data: userData } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!userData?.is_admin) {
    redirect('/')
  }

  const menuItems = [
    { href: '/admin', label: 'Dashboard', icon: '📊' },
    { href: '/admin/products', label: 'Товары', icon: '📦' },
    { href: '/admin/orders', label: 'Заказы', icon: '🛒' },
    { href: '/admin/users', label: 'Пользователи', icon: '👥' },
    { href: '/admin/promo-codes', label: 'Промокоды', icon: '🎟️' },
    { href: '/admin/banners', label: 'Баннеры', icon: '🖼️' },
    { href: '/admin/utm', label: 'UTM', icon: '📈' },
    { href: '/admin/mailings', label: 'Рассылки', icon: '📧' },
    { href: '/admin/settings', label: 'Настройки', icon: '⚙️' },
  ]

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex">
        {/* Боковое меню */}
        <aside className="w-64 bg-surface border-r border-border min-h-screen sticky top-0">
          <div className="p-6">
            <Link href="/admin" className="flex items-center gap-2 mb-8">
              <span className="text-2xl font-bold text-navy">NiceTry</span>
              <span className="badge badge-amber text-[10px]">ADMIN</span>
            </Link>

            <nav className="space-y-1">
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-muted hover:bg-blue-50 hover:text-blue-700 transition-colors"
                >
                  <span className="text-lg">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            <div className="mt-8 pt-6 border-t border-border">
              <Link
                href="/"
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-muted hover:bg-gray-bg transition-colors"
              >
                <span className="text-lg">🏠</span>
                <span>На сайт</span>
              </Link>
            </div>
          </div>
        </aside>

        {/* Основной контент */}
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
