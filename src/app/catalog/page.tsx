'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Product, Category } from '@/types'
import { PCard } from '@/components/PCard'
import { ProductFilters, FilterState } from '@/components/ProductFilters'
import { findCatalogGroup } from '@/lib/catalog-groups'
import { BI } from '@/components/ui/BI'

// Размер страницы каталога. API /api/products отдаёт максимум 200 за запрос (clampInt),
// 50 — баланс между «не грузить всё разом» и числом нажатий «Показать ещё».
const PAGE_SIZE = 50

// useSearchParams требует Suspense-границу (иначе ошибка пререндера),
// поэтому страница — тонкая обёртка над клиентским содержимым.
export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <CatalogContent />
    </Suspense>
  )
}

function CatalogContent() {
  const searchParams = useSearchParams()
  // Параметры из URL: группа из catnav шапки (?group=steam) и поиск (?search=…).
  const groupSlug = searchParams.get('group')
  const urlSearch = searchParams.get('search') || ''
  const group = findCatalogGroup(groupSlug)

  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filters, setFilters] = useState<FilterState>({
    search: urlSearch,
    category_id: '',
    type: '',
    min_price: '',
    max_price: '',
    region: '',
    sort: '',
  })

  // Грузит страницу товаров. append=false — первая страница (сброс при смене фильтров),
  // append=true — догрузка следующей по кнопке «Показать ещё».
  function loadPage(append: boolean) {
    const offset = append ? products.length : 0
    if (append) setLoadingMore(true)
    else setLoading(true)
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value)
    })
    // Группа из catnav: мульти-фильтр по категориям/типам поверх боковых фильтров.
    if (group?.cats?.length) params.append('cats', group.cats.join(','))
    if (group?.types?.length) params.append('types', group.types.join(','))
    params.append('limit', String(PAGE_SIZE))
    params.append('offset', String(offset))
    fetch(`/api/products?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        const page: Product[] = data.products || []
        setProducts((prev) => (append ? [...prev, ...page] : page))
        setTotal(typeof data.total === 'number' ? data.total : page.length)
      })
      .catch((err) => console.error('Failed to load products:', err))
      .finally(() => {
        setLoading(false)
        setLoadingMore(false)
      })
  }

  // Поиск из URL меняется (переход из шапки) — синхронизируем в фильтры.
  useEffect(() => {
    setFilters((f) => (f.search === urlSearch ? f : { ...f, search: urlSearch }))
  }, [urlSearch])

  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []))
      .catch((err) => console.error('Failed to load categories:', err))
  }, [])

  // Смена фильтров или группы из URL — грузим первую страницу заново.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadPage(false)
  }, [filters, groupSlug])

  return (
    <div className="container py-6 sm:py-8">
      <div className="mb-5 sm:mb-6">
        <h1>{group ? group.label : 'Каталог товаров'}</h1>
        <p className="text-muted text-sm mt-1">Цифровые товары с моментальной выдачей</p>
        {group && (
          <Link href="/catalog" className="badge badge-instant mt-2 inline-flex items-center gap-1.5 !h-7 !px-2.5">
            {group.label}
            <BI name="x-lg" size="sm" />
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 lg:gap-6 items-start">
        {/* Фильтры */}
        <ProductFilters
          key={urlSearch}
          onFilterChange={setFilters}
          categories={categories}
          initial={urlSearch ? { search: urlSearch } : undefined}
        />

        {/* Список товаров */}
        <div className="min-w-0">
          {loading ? (
            <div className="prod-grid">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="scard">
                  <div className="cover" />
                  <div className="ln" style={{ width: '70%' }} />
                  <div className="ln" style={{ width: '45%', marginBottom: 14 }} />
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="empty-state card">
              <div className="ico">
                <BI name="search" />
              </div>
              <h3>Товары не найдены</h3>
              <p>Попробуйте изменить запрос или сбросить фильтры — возможно, нужный товар в другой категории.</p>
              {group && (
                <Link href="/catalog" className="btn btn-secondary mt-1">Показать весь каталог</Link>
              )}
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
              {products.length < total && (
                <div className="flex justify-center mt-6 sm:mt-8">
                  <button
                    className="btn btn-secondary"
                    onClick={() => loadPage(true)}
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
