'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Product, Category } from '@/types'
import { PCard } from '@/components/PCard'
import { ProductFilters, FilterState } from '@/components/ProductFilters'
import { RegionTabs } from '@/components/RegionTabs'
import Breadcrumbs from '@/components/Breadcrumbs'
import Spinner from '@/components/ui/Spinner'
import Link from 'next/link'
import { formatProductTitle } from '@/lib/utils'
import { BI } from '@/components/ui/BI'
import REGIONS_LIST from '@/data/regions.json'

const PAGE_SIZE = 50

const EMPTY_FILTERS: FilterState = {
  search: '',
  category_id: '',
  type: '',
  min_price: '',
  max_price: '',
  region: '',
  sort: '',
}

export default function CategoryPage() {
  const params = useParams()
  const slug = params.slug as string

  const [category, setCategory] = useState<Category | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  const categoryRegions = (category?.regions ?? []).map((code) => {
    const found = REGIONS_LIST.find((r) => r.code === code)
    return { value: code, label: found?.name ?? code }
  })
  const hasRegions = categoryRegions.length > 0
  const abortRef = useRef<AbortController | null>(null)

  function buildParams(categoryId: string, offset: number): URLSearchParams {
    const p = new URLSearchParams()
    p.append('category_id', categoryId)
    p.append('category_slug', slug) // всегда передаём slug для корректного fallback-фильтра
    p.append('limit', String(PAGE_SIZE))
    p.append('offset', String(offset))
    if (filters.search) p.append('search', filters.search)
    if (filters.type) p.append('type', filters.type)
    if (filters.min_price) p.append('min_price', filters.min_price)
    if (filters.max_price) p.append('max_price', filters.max_price)
    if (filters.region) p.append('region', filters.region)
    if (filters.sort) p.append('sort', filters.sort)
    return p
  }

  function loadPage(categoryId: string, append: boolean) {
    if (!append) {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
    }
    const signal = abortRef.current?.signal
    const offset = append ? products.length : 0
    if (append) setLoadingMore(true)
    else setLoadingProducts(true)
    fetch(`/api/products?${buildParams(categoryId, offset).toString()}`, { signal })
      .then((res) => res.json())
      .then((data) => {
        const page: Product[] = data.products || []
        setProducts((prev) => (append ? [...prev, ...page] : page))
        setTotal(typeof data.total === 'number' ? data.total : page.length)
      })
      .catch((err) => { if (err.name !== 'AbortError') console.error('Failed to load category products:', err) })
      .finally(() => { setLoadingMore(false); setLoadingProducts(false) })
  }

  // Первичная загрузка категории
  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setProducts([])
    setFilters(EMPTY_FILTERS)
    fetch('/api/categories')
      .then((res) => res.json())
      .then((categoriesData) => {
        const foundCategory =
          categoriesData.categories?.find((c: Category) => c.slug === slug) || null
        setCategory(foundCategory)
      })
      .catch((err) => console.error('Failed to load category:', err))
      .finally(() => setLoading(false))
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Перезагрузка при смене категории или фильтров
  useEffect(() => {
    if (!category) return
    loadPage(category.id, false)
  }, [category, filters]) // eslint-disable-line react-hooks/exhaustive-deps

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
            <BI name="info-circle" />
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
          { label: formatProductTitle(category.name) },
        ]}
      />

      <div className="flex items-center gap-3 mb-6">
        {category.icon && (
          <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-2xl flex-none">
            {category.icon.startsWith('/') || category.icon.startsWith('http') ? (
              <img src={category.icon} alt="" className="w-7 h-7 object-contain" />
            ) : (
              category.icon
            )}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate">{formatProductTitle(category.name)}</h1>
          <p className="text-muted text-sm mt-0.5">
            {total > 0 ? `${total} товаров` : 'Категория'}
          </p>
        </div>
      </div>

      {hasRegions && (
        <RegionTabs
          regions={categoryRegions}
          selected={filters.region}
          onChange={(value) => setFilters((prev) => ({ ...prev, region: value }))}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 lg:gap-6 items-start">
        {/* Боковая панель фильтров */}
        <ProductFilters
          key={slug}
          onFilterChange={(f) => setFilters((prev) => ({ ...f, region: prev.region }))}
        />

        {/* Список товаров */}
        <div className="min-w-0">
          {loadingProducts ? (
            <Spinner label="Загрузка товаров…" />
          ) : products.length === 0 ? (
            <div className="empty-state card">
              <div className="ico">
                <BI name="grid" />
              </div>
              <h3>Товары не найдены</h3>
              <p>Попробуйте изменить фильтры или сбросить их — нужный товар наверняка есть в каталоге.</p>
              <Link href="/catalog" className="btn btn-secondary mt-1">Посмотреть все товары</Link>
            </div>
          ) : (
            <>
              <div className="mb-4 text-sm text-muted">
                Показано <span className="font-semibold text-ink">{products.length}</span> из{' '}
                <span className="font-semibold text-ink">{total}</span>
              </div>
              <div className="prod-grid">
                {products.map((product) => (
                  <PCard key={product.id} product={product} />
                ))}
              </div>
              {category && products.length < total && (
                <div className="flex justify-center mt-6 sm:mt-8">
                  <button
                    className="btn btn-secondary"
                    onClick={() => loadPage(category.id, true)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Загрузка…' : 'Показать ещё'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

