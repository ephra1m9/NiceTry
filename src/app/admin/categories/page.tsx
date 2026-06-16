'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Category {
  id: string
  name: string
  slug: string
  icon?: string
  markup_percent: number
  usd_to_rub_rate: number
  supplier?: string
  is_active: boolean
  sort_order: number
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    search: '',
    supplier: '',
    is_active: '',
  })

  useEffect(() => {
    fetchCategories()
  }, [])

  const fetchCategories = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/categories')
      const data = await res.json()
      setCategories(data.categories || [])
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const filtered = categories.filter((cat) => {
    if (filters.search && !cat.name.toLowerCase().includes(filters.search.toLowerCase()) && !cat.slug.toLowerCase().includes(filters.search.toLowerCase())) return false
    if (filters.supplier && cat.supplier !== filters.supplier) return false
    if (filters.is_active === 'true' && !cat.is_active) return false
    if (filters.is_active === 'false' && cat.is_active) return false
    return true
  })

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Удалить категорию «${name}»?`)) return

    try {
      const res = await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchCategories()
      } else {
        const data = await res.json()
        alert(data.error || 'Ошибка при удалении категории')
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
      alert('Ошибка при удалении категории')
    }
  }

  const supplierLabel: Record<string, string> = {
    approute: 'AppRoute',
    dessly: 'Dessly',
  }

  return (
    <div className="max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[30px] font-bold text-navy mb-2">Категории</h1>
          <p className="text-muted">Управление категориями каталога</p>
        </div>
        <Link href="/admin/categories/new" className="btn btn-primary">
          Создать категорию
        </Link>
      </div>

      {/* Фильтры */}
      <div className="card card-pad mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="Поиск по названию или slug..."
            className="input"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
          />

          <select
            className="input"
            value={filters.supplier}
            onChange={(e) => handleFilterChange('supplier', e.target.value)}
          >
            <option value="">Все поставщики</option>
            <option value="approute">AppRoute</option>
            <option value="dessly">Dessly</option>
          </select>

          <select
            className="input"
            value={filters.is_active}
            onChange={(e) => handleFilterChange('is_active', e.target.value)}
          >
            <option value="">Все статусы</option>
            <option value="true">Активные</option>
            <option value="false">Неактивные</option>
          </select>
        </div>

        <div className="mt-4">
          <button onClick={fetchCategories} className="btn btn-primary">
            Применить фильтры
          </button>
        </div>
      </div>

      {/* Таблица */}
      {loading ? (
        <div className="text-center py-12 text-muted">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="card card-pad text-center py-12 text-muted">
          Категории не найдены
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Название</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Slug</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Поставщик</th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">Наценка</th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">Курс USD→RUB</th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">Статус</th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((cat) => (
                  <tr key={cat.id} className="border-b border-border hover:bg-gray-bg">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {cat.icon && (
                          <img src={cat.icon} alt="" className="w-6 h-6 object-contain" />
                        )}
                        <span className="font-semibold text-navy">{cat.name}</span>
                      </div>
                    </td>
                    <td className="p-4 text-muted font-mono text-sm">{cat.slug}</td>
                    <td className="p-4 text-muted">
                      {cat.supplier ? supplierLabel[cat.supplier] ?? cat.supplier : '—'}
                    </td>
                    <td className="p-4 text-right text-navy font-semibold">
                      {cat.markup_percent}%
                    </td>
                    <td className="p-4 text-right text-navy font-semibold">
                      {cat.usd_to_rub_rate} ₽
                    </td>
                    <td className="p-4 text-center">
                      <span className={`badge ${cat.is_active ? 'badge-stock' : 'badge-out'}`}>
                        {cat.is_active ? 'Активна' : 'Неактивна'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/categories/${cat.id}`}
                          className="btn btn-sm btn-ghost"
                        >
                          Редактировать
                        </Link>
                        <button
                          onClick={() => handleDelete(cat.id, cat.name)}
                          className="btn btn-sm btn-ghost text-red hover:bg-red-bg"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
