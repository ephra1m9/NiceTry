'use client'

import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/hooks/useUser'
import { useCart } from '@/hooks/useCart'

export default function Header() {
  const { user: authUser, signOut } = useAuth()
  const { user } = useUser()
  const { totalItems } = useCart()

  return (
    <header className="bg-white border-b border-border sticky top-0 z-50">
      <div className="container">
        <div className="flex items-center justify-between h-16">
          {/* Логотип */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">N</span>
            </div>
            <span className="text-navy font-bold text-lg">NiceTry</span>
          </Link>

          {/* Поиск */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <input
              type="search"
              placeholder="Поиск товаров..."
              className="input"
            />
          </div>

          {/* Правая часть */}
          <div className="flex items-center gap-4">
            {/* Корзина */}
            <Link href="/cart" className="relative btn btn-ghost btn-sm">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red text-white text-xs font-bold rounded-full flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </Link>

            {authUser ? (
              <>
                {/* Баланс */}
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
                  <span className="text-sm text-muted">Баланс:</span>
                  <span className="text-sm font-semibold text-navy">
                    {user?.balance?.toFixed(2) || '0.00'} ₽
                  </span>
                </div>

                {/* Статус */}
                {user?.status && (
                  <div className="hidden sm:block">
                    <span className="badge badge-amber">
                      {user.status.name}
                    </span>
                  </div>
                )}

                {/* Меню пользователя */}
                <div className="flex items-center gap-2">
                  <Link href="/profile" className="btn btn-ghost btn-sm">
                    Профиль
                  </Link>
                  <button onClick={signOut} className="btn btn-ghost btn-sm">
                    Выход
                  </button>
                </div>
              </>
            ) : (
              <Link href="/auth/login" className="btn btn-primary btn-sm">
                Войти
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
