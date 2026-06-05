'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Product, Category } from '@/types'
import { PCard } from '@/components/PCard'
import Breadcrumbs from '@/components/Breadcrumbs'
import Spinner from '@/components/ui/Spinner'
import Link from 'next/link'

const PAGE_SIZE = 50

export default function CategoryPage() {
  const params = useParams()
  const slug = params.slug as string

  const [category, setCategory] = useState<Category | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Догрузка товаров категории серверным фильтром (category_id), а не клиентским срезом.
  function loadMore(categoryId: string, append: boolean) {
    const offset = append ? products.length : 0
    if (append) setLoadingMore(true)
    fetch(`/api/products?category_id=${encodeURIComponent(categoryId)}&limit=${PAGE_SIZE}&offset=${offset}`)
      .then((res) => res.json())
      .then((data) => {
        const page: Product[] = data.products || []
        setProducts((prev) => (append ? [...prev, ...page] : page))
        setTotal(typeof data.total === 'number' ? data.total : page.length)
      })
      .catch((err) => console.error('Failed to load category products:', err))
      .finally(() => setLoadingMore(false))
  }

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setProducts([])
    fetch('/api/categories')
      .then((res) => res.json())
      .then((categoriesData) => {
        const foundCategory =
          categoriesData.categories?.find((c: Category) => c.slug === slug) || null
        setCategory(foundCategory)
        if (foundCategory) loadMore(foundCategory.id, false)
      })
      .catch((err) => console.error('Failed to load category:', err))
      .finally(() => setLoading(false))
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="container py-8">
        <Spinner label="Загрузка категории…" />
      </div>
    )
  }

  if (!category) {
    return (
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <svg className="ic" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h3>Категория не найдена</h3>
          <p>Возможно, ссылка устарела. Загляните в общий каталог — нужный товар наверняка там.</p>
          <Link href="/catalog" className="btn btn-primary mt-1">В каталог</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-6 sm:py-8">
      <Breadcrumbs
        items={[
          { label: 'Главная', href: '/' },
          { label: 'Каталог', href: '/catalog' },
          { label: category.name },
        ]}
      />

      <div className="flex items-center gap-3 mb-6">
        {category.icon && (
          <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-2xl flex-none">
            {category.icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate">{category.name}</h1>
          <p className="text-muted text-sm mt-0.5">
            {total > 0 ? `${total} товаров` : 'Категория'}
          </p>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="empty-state card">
          <div className="ico">
            <svg className="ic" viewBox="0 0 24 24">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="M4 9h16" />
            </svg>
          </div>
          <h3>В этой категории пока нет товаров</h3>
          <p>Мы регулярно добавляем новые позиции. А пока посмотрите весь каталог.</p>
          <Link href="/catalog" className="btn btn-secondary mt-1">Посмотреть все товары</Link>
        </div>
      ) : (
        <>
          <div className="prod-grid">
            {products.map((product) => (
              <PCard key={product.id} product={product} />
            ))}
          </div>
          {category && products.length < total && (
            <div className="flex justify-center mt-6 sm:mt-8">
              <button
                className="btn btn-secondary"
                onClick={() => loadMore(category.id, true)}
                disabled={loadingMore}
              >
                {loadingMore ? 'Загрузка…' : 'Показать ещё'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
