'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCart } from '@/hooks/useCart'
import { useUser } from '@/hooks/useUser'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Alert from '@/components/ui/Alert'

export default function CheckoutPage() {
  const router = useRouter()
  const { user: authUser } = useAuth()
  const { user } = useUser()
  const { items, totalAmount, clearCart, promo, promoDiscount } = useCart()

  const [paymentMethod, setPaymentMethod] = useState<'balance' | 'card'>('balance')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const statusDiscount = user?.status?.discount_percent
    ? (totalAmount * user.status.discount_percent) / 100
    : 0
  const finalAmount = Math.max(0, totalAmount - statusDiscount - promoDiscount)
  const insufficient = paymentMethod === 'balance' && !!user && user.balance < finalAmount

  const handleSubmit = async () => {
    if (!authUser) {
      router.push('/auth/login?redirect=/checkout')
      return
    }
    if (items.length === 0) {
      router.push('/cart')
      return
    }
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
          // Промокод передаём серверу — он пересчитает и применит скидку авторитетно.
          promo_code: promo?.code,
          total_amount: totalAmount,
          discount_amount: statusDiscount + promoDiscount,
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
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></svg>
          </div>
          <h3>Требуется авторизация</h3>
          <p>Войдите в аккаунт, чтобы оформить заказ и получить товар.</p>
          <Link href="/auth/login?redirect=/checkout" className="btn btn-primary mt-1">Войти</Link>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <svg className="ic" viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 12.4a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 7H6" /></svg>
          </div>
          <h3>Корзина пуста</h3>
          <p>Добавьте товары в корзину перед оформлением заказа.</p>
          <Link href="/catalog" className="btn btn-primary mt-1">Перейти в каталог</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-6 sm:py-8">
      <h1 className="mb-5 sm:mb-6">Оформление заказа</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6 items-start">
        {/* Основная информация */}
        <div className="lg:col-span-2 space-y-5">
          {/* Способ оплаты */}
          <Card padding={false}>
            <div className="card-pad">
              <h2 className="mb-4">Способ оплаты</h2>
              <div className="space-y-3">
                <label
                  className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                    paymentMethod === 'balance' ? 'border-blue bg-blue-50/60 ring-1 ring-blue/30' : 'border-border hover:border-blue-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="balance"
                    checked={paymentMethod === 'balance'}
                    onChange={(e) => setPaymentMethod(e.target.value as 'balance')}
                    className="radio mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-navy mb-0.5">Оплата с баланса</div>
                    <div className="text-sm text-muted">Доступно: {formatPrice(user?.balance || 0)}</div>
                    {insufficient && (
                      <div className="text-xs text-red mt-1 font-medium">Недостаточно средств — пополните баланс.</div>
                    )}
                  </div>
                </label>

                <label className="flex items-start gap-3 p-4 border border-border rounded-lg cursor-not-allowed opacity-60">
                  <input type="radio" name="payment" value="card" disabled className="radio mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold text-navy mb-0.5 flex items-center gap-2">
                      Оплата картой
                      <span className="badge badge-amber !h-5">скоро</span>
                    </div>
                    <div className="text-sm text-muted">Скоро будет доступно</div>
                  </div>
                </label>
              </div>
            </div>
          </Card>

          {/* Список товаров */}
          <Card padding={false}>
            <div className="card-pad">
              <h2 className="mb-4">Товары в заказе</h2>
              <div className="space-y-3">
                {items.map((item, index) => (
                  <div
                    key={`${item.product.id}-${index}`}
                    className="flex justify-between items-start gap-3 pb-3 border-b border-border-2 last:border-0 last:pb-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-navy truncate">{item.product.name}</div>
                      {item.customAmount ? (
                        <div className="text-sm text-muted">Сумма: {formatPrice(item.customAmount)}</div>
                      ) : (
                        <div className="text-sm text-muted">{formatPrice(item.product.price)} × {item.quantity}</div>
                      )}
                    </div>
                    <div className="font-semibold text-navy whitespace-nowrap">
                      {formatPrice(item.customAmount || item.product.price * item.quantity)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Итого */}
        <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-24" padding={false}>
            <div className="card-pad">
              <h2 className="mb-4">Итого</h2>

              <div className="space-y-2 mb-4 pb-4 border-b border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Сумма товаров</span>
                  <span className="font-semibold">{formatPrice(totalAmount)}</span>
                </div>
                {statusDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Скидка статуса ({user?.status?.discount_percent}%)</span>
                    <span className="font-semibold text-green">−{formatPrice(statusDiscount)}</span>
                  </div>
                )}
                {promoDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Промокод{promo?.code ? ` (${promo.code})` : ''}</span>
                    <span className="font-semibold text-green">−{formatPrice(promoDiscount)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mb-5">
                <span className="text-lg font-bold text-navy">К оплате</span>
                <span className="text-2xl font-extrabold text-navy">{formatPrice(finalAmount)}</span>
              </div>

              {error && <div className="mb-4"><Alert variant="error">{error}</Alert></div>}

              <Button variant="primary" size="lg" onClick={handleSubmit} loading={processing} disabled={insufficient} block>
                Оплатить
              </Button>

              <p className="text-xs text-muted-2 text-center mt-3">
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
