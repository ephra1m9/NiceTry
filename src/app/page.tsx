'use client'

import { useAuth } from '@/hooks/useAuth'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import { Category } from '@/types'

export default function HomePage() {
  const { user, loading } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []))
      .catch((err) => console.error('Failed to load categories:', err))
  }, [])

  return (
    <div className="container py-12">
      <div className="text-center max-w-3xl mx-auto">
        <div className="mb-6">
          <svg
            width="150"
            viewBox="0 0 320 70"
            xmlns="http://www.w3.org/2000/svg"
            className="mx-auto"
          >
            <text x="0" y="52" fontFamily="Arial" fontWeight="900" fontSize="58" fill="#1C8CE3">N</text>
            <text x="38" y="52" fontFamily="Arial" fontWeight="900" fontSize="58" fill="#0F1E2E">T</text>
            <text x="92" y="40" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="40" fill="#1C8CE3">Nice</text>
            <text x="150" y="64" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="40" fill="#0F1E2E">try</text>
          </svg>
        </div>

        <h1 className="text-4xl font-bold text-navy mb-4">
          Магазин цифровых товаров
        </h1>

        <p className="text-muted mb-8 text-lg">
          Пополнение игровых аккаунтов, ключи и коды активации, gift-карты, подписки
        </p>

        {!loading && (
          <div className="flex gap-4 justify-center">
            {user ? (
              <>
                <Link href="/catalog">
                  <Button variant="primary" size="lg">
                    Перейти в каталог
                  </Button>
                </Link>
                <Link href="/profile">
                  <Button variant="secondary" size="lg">
                    Мой профиль
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/auth/login">
                  <Button variant="primary" size="lg">
                    Войти
                  </Button>
                </Link>
                <Link href="/catalog">
                  <Button variant="secondary" size="lg">
                    Каталог товаров
                  </Button>
                </Link>
              </>
            )}
          </div>
        )}

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card card-pad text-center">
            <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-blue" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="font-bold text-navy mb-2">Моментальная доставка</h3>
            <p className="text-sm text-muted">
              Получайте товары сразу после оплаты
            </p>
          </div>

          <div className="card card-pad text-center">
            <div className="w-12 h-12 bg-green-bg rounded-lg flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="font-bold text-navy mb-2">Безопасные платежи</h3>
            <p className="text-sm text-muted">
              Защищённые транзакции и конфиденциальность
            </p>
          </div>

          <div className="card card-pad text-center">
            <div className="w-12 h-12 bg-amber-bg rounded-lg flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-amber" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-bold text-navy mb-2">Выгодные цены</h3>
            <p className="text-sm text-muted">
              Система скидок и реферальная программа
            </p>
          </div>
        </div>
      </div>

      {/* Категории товаров */}
      {categories.length > 0 && (
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-navy mb-6 text-center">
            Категории товаров
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className="card card-pad text-center hover:shadow-md transition-shadow duration-200"
              >
                <div className="text-3xl mb-2">{category.icon || '📦'}</div>
                <h3 className="font-semibold text-navy">{category.name}</h3>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
