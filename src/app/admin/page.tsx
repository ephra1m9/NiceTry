import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function AdminDashboard() {
  const supabase = await createClient()

  // Получаем статистику
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Заказы сегодня
  const { data: todayOrders, count: todayOrdersCount } = await supabase
    .from('orders')
    .select('final_amount', { count: 'exact' })
    .gte('created_at', today.toISOString())

  const todayRevenue = todayOrders?.reduce((sum, order) => sum + Number(order.final_amount), 0) || 0

  // Новые пользователи сегодня
  const { count: newUsersCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())

  // Всего пользователей
  const { count: totalUsers } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })

  // Последние заказы
  const { data: recentOrders } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      final_amount,
      status,
      created_at,
      users (email)
    `)
    .order('created_at', { ascending: false })
    .limit(10)

  // Топ товаров (по количеству заказов)
  const { data: topProducts } = await supabase
    .from('order_items')
    .select(`
      product_id,
      product_name,
      quantity,
      products (name, price)
    `)
    .limit(100)

  // Группируем топ товары
  const productStats = topProducts?.reduce((acc: any, item) => {
    const key = item.product_id || 'unknown'
    if (!acc[key]) {
      acc[key] = {
        name: item.product_name,
        count: 0,
        revenue: 0,
      }
    }
    acc[key].count += item.quantity
    acc[key].revenue += Number(item.products?.price || 0) * item.quantity
    return acc
  }, {})

  const topProductsList = Object.values(productStats || {})
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 5)

  const statusColors: Record<string, string> = {
    new: 'badge-amber',
    paid: 'badge-instant',
    delivered: 'badge-stock',
    cancelled: 'badge-out',
  }

  const statusLabels: Record<string, string> = {
    new: 'Новый',
    paid: 'Оплачен',
    delivered: 'Доставлен',
    cancelled: 'Отменён',
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Dashboard</h1>
        <p className="text-muted">Обзор статистики и активности</p>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="card card-pad">
          <div className="text-muted-2 text-sm mb-1">Заказы сегодня</div>
          <div className="text-2xl font-bold text-navy">{todayOrdersCount || 0}</div>
        </div>

        <div className="card card-pad">
          <div className="text-muted-2 text-sm mb-1">Выручка сегодня</div>
          <div className="text-2xl font-bold text-navy">{todayRevenue.toFixed(2)} ₽</div>
        </div>

        <div className="card card-pad">
          <div className="text-muted-2 text-sm mb-1">Новые пользователи</div>
          <div className="text-2xl font-bold text-navy">{newUsersCount || 0}</div>
        </div>

        <div className="card card-pad">
          <div className="text-muted-2 text-sm mb-1">Всего пользователей</div>
          <div className="text-2xl font-bold text-navy">{totalUsers || 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Последние заказы */}
        <div className="card">
          <div className="p-6 border-b border-border">
            <h2 className="text-[17px] font-bold text-navy">Последние заказы</h2>
          </div>
          <div className="p-6">
            {recentOrders && recentOrders.length > 0 ? (
              <div className="space-y-4">
                {recentOrders.map((order: any) => (
                  <Link
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-blue hover:bg-blue-50 transition-all"
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-navy mb-1">
                        #{order.order_number}
                      </div>
                      <div className="text-sm text-muted">
                        {order.users?.email || 'Гость'}
                      </div>
                    </div>
                    <div className="text-right mr-4">
                      <div className="font-semibold text-navy mb-1">
                        {Number(order.final_amount).toFixed(2)} ₽
                      </div>
                      <div className="text-xs text-muted-2">
                        {new Date(order.created_at).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                    <span className={`badge ${statusColors[order.status]}`}>
                      {statusLabels[order.status]}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted">
                Заказов пока нет
              </div>
            )}
          </div>
        </div>

        {/* Топ товаров */}
        <div className="card">
          <div className="p-6 border-b border-border">
            <h2 className="text-[17px] font-bold text-navy">Топ товаров</h2>
          </div>
          <div className="p-6">
            {topProductsList && topProductsList.length > 0 ? (
              <div className="space-y-4">
                {topProductsList.map((product: any, index: number) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-navy mb-1">
                          {product.name}
                        </div>
                        <div className="text-sm text-muted">
                          {product.count} продаж
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-navy">
                        {product.revenue.toFixed(2)} ₽
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted">
                Данных пока нет
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
