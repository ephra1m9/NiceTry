'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCart } from '@/hooks/useCart'
import { useUser } from '@/hooks/useUser'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

export default function CheckoutPage() {
  const router = useRouter()
  const { user: authUser } = useAuth()
  const { user } = useUser()
  const { items, totalAmount, clearCart } = useCart()

  const [paymentMethod, setPaymentMethod] = useState<'balance' | 'card'>('balance')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const statusDiscount = user?.status?.discount_percent
    ? (totalAmount * user.status.discount_percent) / 100
    : 0

  const finalAmount = Math.max(0, totalAmount - statusDiscount)

  const handleSubmit = async () => {
    if (!authUser) {
      router.push('/auth/login?redirect=/checkout')
      return
    }

    if (items.length === 0) {
      router.push('/cart')
      return
    }

    // Проверка баланса при оплате с баланса
    if (paymentMethod === 'balance' && user && user.balance < finalAmount) {
      setError('Недостаточно средств на балансе')
      return
    }

    setProcessing(true)
    setError('')

    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            price: item.customAmount || item.product.price,
            custom_amount: item.customAmount,
            form_data: item.formData,
          })),
          payment_method: paymentMethod,
          total_amount: totalAmount,
          discount_amount: statusDiscount,
          final_amount: finalAmount,
        }),
      })

      const data = await res.json()

      if (res.ok && data.order) {
        clearCart()
        router.push(`/orders/${data.order.id}`)
      } else {
        setError(data.error || 'Ошибка создания заказа')
        setProcessing(false)
      }
    } catch (err) {
      console.error('Checkout error:', err)
      setError('Произошла ошибка при оформлении заказа')
      setProcessing(false)
    }
  }

  if (!authUser) {
    return (
      <div className="container py-12">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-navy mb-4">
            Требуется авторизация
          </h1>
          <p className="text-muted mb-6">
            Войдите в систему, чтобы оформить заказ
          </p>
          <Link href="/auth/login?redirect=/checkout">
            <Button variant="primary" size="lg">
              Войти
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="container py-12">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-navy mb-4">
            Корзина пуста
          </h1>
          <p className="text-muted mb-6">
            Добавьте товары в корзину перед оформлением заказа
          </p>
          <Link href="/catalog">
            <Button variant="primary" size="lg">
              Перейти в каталог
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold text-navy mb-6">Оформление заказа</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Основная информация */}
        <div className="lg:col-span-2 space-y-6">
          {/* Способ оплаты */}
          <Card>
            <div className="card-pad">
              <h2 className="text-xl font-bold text-navy mb-4">
                Способ оплаты
              </h2>

              <div className="space-y-3">
                {/* Оплата с баланса */}
                <label className="flex items-start gap-3 p-4 border-2 border-border rounded-lg cursor-pointer hover:border-blue transition-colors">
                  <input
                    type="radio"
                    name="payment"
                    value="balance"
                    checked={paymentMethod === 'balance'}
                    onChange={(e) => setPaymentMethod(e.target.value as 'balance')}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-navy mb-1">
                      Оплата с баланса
                    </div>
                    <div className="text-sm text-muted">
                      Доступно: {formatPrice(user?.balance || 0)}
                    </div>
                    {user && user.balance < finalAmount && (
                      <div className="text-xs text-red mt-1">
                        Недостаточно средств. Пополните баланс.
                      </div>
                    )}
                  </div>
                </label>

                {/* Оплата картой (заглушка) */}
                <label className="flex items-start gap-3 p-4 border-2 border-border rounded-lg cursor-pointer hover:border-blue transition-colors opacity-50">
                  <input
                    type="radio"
                    name="payment"
                    value="card"
                    checked={paymentMethod === 'card'}
                    onChange={(e) => setPaymentMethod(e.target.value as 'card')}
                    className="mt-1"
                    disabled
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-navy mb-1">
                      Оплата картой
                    </div>
                    <div className="text-sm text-muted">
                      Скоро будет доступно
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </Card>

          {/* Список товаров */}
          <Card>
            <div className="card-pad">
              <h2 className="text-xl font-bold text-navy mb-4">
                Товары в заказе
              </h2>

              <div className="space-y-3">
                {items.map((item, index) => (
                  <div
                    key={`${item.product.id}-${index}`}
                    className="flex justify-between items-start pb-3 border-b border-border last:border-0"
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-navy">
                        {item.product.name}
                      </div>
                      {item.customAmount ? (
                        <div className="text-sm text-muted">
                          Сумма: {formatPrice(item.customAmount)}
                        </div>
                      ) : (
                        <div className="text-sm text-muted">
                          {formatPrice(item.product.price)} × {item.quantity}
                        </div>
                      )}
                    </div>
                    <div className="font-semibold text-navy">
                      {formatPrice(
                        item.customAmount || item.product.price * item.quantity
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Итого */}
        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <div className="card-pad">
              <h2 className="text-xl font-bold text-navy mb-4">Итого</h2>

              <div className="space-y-2 mb-4 pb-4 border-b border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Сумма товаров:</span>
                  <span className="font-semibold">{formatPrice(totalAmount)}</span>
                </div>

                {statusDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">
                      Скидка статуса ({user?.status?.discount_percent}%):
                    </span>
                    <span className="font-semibold text-green">
                      -{formatPrice(statusDiscount)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mb-6">
                <span className="text-lg font-bold text-navy">К оплате:</span>
                <span className="text-2xl font-bold text-navy">
                  {formatPrice(finalAmount)}
                </span>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-bg text-red text-sm rounded-lg">
                  {error}
                </div>
              )}

              <Button
                variant="primary"
                size="lg"
                onClick={handleSubmit}
                disabled={processing || (paymentMethod === 'balance' && user ? user.balance < finalAmount : false)}
                className="w-full"
              >
                {processing ? 'Обработка...' : 'Оплатить'}
              </Button>

              <p className="text-xs text-muted text-center mt-3">
                Нажимая кнопку, вы соглашаетесь с условиями использования
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
}
