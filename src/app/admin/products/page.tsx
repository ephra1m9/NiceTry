'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ProductType } from '@/types'

interface Product {
  id: string
  name: string
  type: ProductType
  price: number
  stock?: number
  is_active: boolean
  categories?: {
    name: string
    slug: string
  }
}

interface Category {
  id: string
  name: string
  slug: string
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    category: '',
    type: '',
    search: '',
    is_active: '',
  })

  useEffect(() => {
    fetchCategories()
    fetchProducts()
  }, [])

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories')
      const data = await res.json()
      setCategories(data.categories || [])
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    }
  }

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filters.category) params.set('category', filters.category)
      if (filters.type) params.set('type', filters.type)
      if (filters.search) params.set('search', filters.search)
      if (filters.is_active) params.set('is_active', filters.is_active)

      const res = await fetch(`/api/admin/products?${params}`)
      const data = await res.json()
      setProducts(data.products || [])
    } catch (error) {
      console.error('Failed to fetch products:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleSearch = () => {
    fetchProducts()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить товар?')) return

    try {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        fetchProducts()
      } else {
        alert('Ошибка при удалении товара')
      }
    } catch (error) {
      console.error('Failed to delete product:', error)
      alert('Ошибка при удалении товара')
    }
  }

  const handleImport = async () => {
    if (!confirm('Импортировать товары из AppRoute?')) return

    try {
      const res = await fetch('/api/products/import', {
        method: 'POST',
      })

      if (res.ok) {
        const data = await res.json()
        alert(`Импортировано товаров: ${data.imported || 0}`)
        fetchProducts()
      } else {
        alert('Ошибка при импорте товаров')
      }
    } catch (error) {
      console.error('Failed to import products:', error)
      alert('Ошибка при импорте товаров')
    }
  }

  const typeLabels: Record<ProductType, string> = {
    instant: 'Моментальный',
    topup_auto: 'Пополнение (авто)',
    topup_manual: 'Пополнение (ручное)',
    manual: 'Ручная обработка',
  }

  const typeBadges: Record<ProductType, string> = {
    instant: 'badge-instant',
    topup_auto: 'badge-stock',
    topup_manual: 'badge-amber',
    manual: 'badge-out',
  }

  return (
    <div className="max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[30px] font-bold text-navy mb-2">Товары</h1>
          <p className="text-muted">Управление каталогом товаров</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleImport} className="btn btn-secondary">
            Импорт из AppRoute
          </button>
          <Link href="/admin/products/new" className="btn btn-primary">
            Создать товар
          </Link>
        </div>
      </div>

      {/* Фильтры */}
      <div className="card card-pad mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="Поиск по названию..."
            className="input"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />

          <select
            className="input"
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
          >
            <option value="">Все категории</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={filters.type}
            onChange={(e) => handleFilterChange('type', e.target.value)}
          >
            <option value="">Все типы</option>
            <option value="instant">Моментальный</option>
            <option value="topup_auto">Пополнение (авто)</option>
            <option value="topup_manual">Пополнение (ручное)</option>
            <option value="manual">Ручная обработка</option>
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
          <button onClick={handleSearch} className="btn btn-primary">
            Применить фильтры
          </button>
        </div>
      </div>

      {/* Список товаров */}
      {loading ? (
        <div className="text-center py-12 text-muted">Загрузка...</div>
      ) : products.length === 0 ? (
        <div className="card card-pad text-center py-12 text-muted">
          Товары не найдены
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Название
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Категория
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Тип
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Цена
                  </th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">
                    Остаток
                  </th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">
                    Статус
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b border-border hover:bg-gray-bg">
                    <td className="p-4">
                      <div className="font-semibold text-navy">{product.name}</div>
                    </td>
                    <td className="p-4 text-muted">
                      {product.categories?.name || '—'}
                    </td>
                    <td className="p-4">
                      <span className={`badge ${typeBadges[product.type]}`}>
                        {typeLabels[product.type]}
                      </span>
                    </td>
                    <td className="p-4 text-right font-semibold text-navy">
                      {product.price.toFixed(2)} ₽
                    </td>
                    <td className="p-4 text-center text-muted">
                      {product.stock ?? '∞'}
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`badge ${
                          product.is_active ? 'badge-stock' : 'badge-out'
                        }`}
                      >
                        {product.is_active ? 'Активен' : 'Неактивен'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="btn btn-sm btn-ghost"
                        >
                          Редактировать
                        </Link>
                        <button
                          onClick={() => handleDelete(product.id)}
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
