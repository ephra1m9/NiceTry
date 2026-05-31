'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Product, Category } from '@/types'
import { ProductCard } from '@/components/ProductCard'
import Link from 'next/link'

export default function CategoryPage() {
  const params = useParams()
  const slug = params.slug as string

  const [category, setCategory] = useState<Category | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return

    setLoading(true)

    // Загрузка категории и товаров
    Promise.all([
      fetch('/api/categories').then((res) => res.json()),
      fetch('/api/products').then((res) => res.json()),
    ])
      .then(([categoriesData, productsData]) => {
        const foundCategory = categoriesData.categories?.find(
          (c: Category) => c.slug === slug
        )
        setCategory(foundCategory || null)

        if (foundCategory) {
          const filteredProducts = productsData.products?.filter(
            (p: Product) => p.category_id === foundCategory.id
          )
          setProducts(filteredProducts || [])
        }

        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load category:', err)
        setLoading(false)
      })
  }, [slug])

  if (loading) {
    return (
      <div className="container py-12 text-center">
        <div className="inline-block w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin"></div>
        <p className="text-muted mt-4">Загрузка...</p>
      </div>
    )
  }

  if (!category) {
    return (
      <div className="container py-12 text-center">
        <h1 className="text-2xl font-bold text-navy mb-4">
          Категория не найдена
        </h1>
        <Link href="/catalog" className="text-blue hover:underline">
          Вернуться в каталог
        </Link>
      </div>
    )
  }

  return (
    <div className="container py-8">
      {/* Хлебные крошки */}
      <div className="text-sm text-muted mb-4">
        <Link href="/" className="hover:text-blue">
          Главная
        </Link>
        {' / '}
        <Link href="/catalog" className="hover:text-blue">
          Каталог
        </Link>
        {' / '}
        <span className="text-navy">{category.name}</span>
      </div>

      {/* Заголовок категории */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {category.icon && <span className="text-4xl">{category.icon}</span>}
          <h1 className="text-3xl font-bold text-navy">{category.name}</h1>
        </div>
      </div>

      {/* Товары */}
      {products.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted text-lg">
            В этой категории пока нет товаров
          </p>
          <Link
            href="/catalog"
            className="inline-block mt-4 text-blue hover:underline"
          >
            Посмотреть все товары
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 text-sm text-muted">
            Товаров в категории: {products.length}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
