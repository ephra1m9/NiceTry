'use client'

import { useEffect, useState } from 'react'
import { Product, Category } from '@/types'
import { ProductCard } from '@/components/ProductCard'
import { ProductFilters, FilterState } from '@/components/ProductFilters'

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    category_id: '',
    type: '',
    supplier: '',
    min_price: '',
    max_price: '',
  })

  useEffect(() => {
    // Загрузка категорий
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []))
      .catch((err) => console.error('Failed to load categories:', err))
  }, [])

  useEffect(() => {
    // Загрузка товаров с фильтрами
    setLoading(true)

    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value)
    })

    fetch(`/api/products?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setProducts(data.products || [])
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load products:', err)
        setLoading(false)
      })
  }, [filters])

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold text-navy mb-6">Каталог товаров</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Фильтры */}
        <div className="lg:col-span-1">
          <ProductFilters
            onFilterChange={setFilters}
            categories={categories}
          />
        </div>

        {/* Список товаров */}
        <div className="lg:col-span-3">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin"></div>
              <p className="text-muted mt-4">Загрузка товаров...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted text-lg">Товары не найдены</p>
              <p className="text-sm text-muted-2 mt-2">
                Попробуйте изменить параметры фильтрации
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 text-sm text-muted">
                Найдено товаров: {products.length}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
