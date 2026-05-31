'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCart } from '@/hooks/useCart'
import { useUser } from '@/hooks/useUser'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Card from '@/components/ui/Card'

export default function CartPage() {
  const router = useRouter()
  const { items, removeFromCart, updateQuantity, clearCart, totalAmount } = useCart()
  const { user } = useUser()

  const [promoCode, setPromoCode] = useState('')
  const [promoDiscount, setPromoDiscount] = useState(0)
  const [promoError, setPromoError] = useState('')

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return

    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode }),
      })

      const data = await res.json()

      if (res.ok && data.valid) {
        if (data.discount_type === 'percent') {
          setPromoDiscount((totalAmount * data.discount_value) / 100)
        } else {
          setPromoDiscount(data.discount_value)
        }
        setPromoError('')
      } else {
        setPromoError(data.error || 'Промокод недействителен')
        setPromoDiscount(0)
      }
    } catch (err) {
      setPromoError('Ошибка проверки промокода')
      setPromoDiscount(0)
    }
  }

  const statusDiscount = user?.status?.discount_percent
    ? (totalAmount * user.status.discount_percent) / 100
    : 0

  const finalAmount = Math.max(0, totalAmount - statusDiscount - promoDiscount)

  const handleCheckout = () => {
    router.push('/checkout')
  }

  if (items.length === 0) {
    return (
      <div className="container py-12">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-6xl mb-4">🛒</div>
          <h1 className="text-2xl font-bold text-navy mb-4">
            Корзина пуста
          </h1>
          <p className="text-muted mb-6">
            Добавьте товары из каталога, чтобы оформить заказ
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
      <h1 className="text-3xl font-bold text-navy mb-6">Корзина</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Список товаров */}
        <div className="lg:col-span-2 space-y-4">
          {items.map((item, index) => (
            <Card key={`${item.product.id}-${index}`}>
              <div className="card-pad">
                <div className="flex gap-4">
                  {/* Изображение */}
                  <div className="w-20 h-20 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    {item.product.image_url ? (
                      <img
                        src={item.product.image_url}
                        alt={item.product.name}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <span className="text-2xl">
                        {getProductIcon(item.product.type)}
                      </span>
                    )}
                  </div>

                  {/* Информация */}
                  <div className="flex-1">
                    <h3 className="font-semibold text-navy mb-1">
                      {item.product.name}
                    </h3>

                    {/* Для topup товаров показываем сумму и данные */}
                    {item.customAmount ? (
                      <div className="text-sm text-muted space-y-1">
                        <p>Сумма: {formatPrice(item.customAmount)}</p>
                        {item.formData &&
                          Object.entries(item.formData).map(([key, value]) => (
                            <p key={key}>
                              {key}: {value}
                            </p>
                          ))}
                      </div>
                    ) : (
                      <>
                        {/* Цена за единицу */}
                        <p className="text-sm text-muted mb-2">
                          {formatPrice(item.product.price)} × {item.quantity}
                        </p>

                        {/* Управление количеством */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              updateQuantity(
                                item.product.id,
                                item.quantity - 1
                              )
                            }
                            className="w-8 h-8 border border-border rounded hover:bg-gray-50 transition-colors text-sm"
                            disabled={item.quantity <= 1}
                          >
                            −
                          </button>
                          <span className="w-12 text-center text-sm font-semibold">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() =>
                              updateQuantity(
                                item.product.id,
                                item.quantity + 1
                              )
                            }
                            className="w-8 h-8 border border-border rounded hover:bg-gray-50 transition-colors text-sm"
                          >
                            +
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Цена и удаление */}
                  <div className="text-right flex flex-col justify-between">
                    <p className="font-bold text-navy">
                      {formatPrice(
                        item.customAmount || item.product.price * item.quantity
                      )}
                    </p>
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="text-sm text-red hover:underline"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {/* Очистить корзину */}
          <button
            onClick={clearCart}
            className="text-sm text-muted hover:text-red transition-colors"
          >
            Очистить корзину
          </button>
        </div>

        {/* Итого */}
        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <div className="card-pad">
              <h2 className="text-xl font-bold text-navy mb-4">Итого</h2>

              {/* Промокод */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-navy mb-2">
                  Промокод
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Введите промокод"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleApplyPromo}
                  >
                    Применить
                  </Button>
                </div>
                {promoError && (
                  <p className="text-xs text-red mt-1">{promoError}</p>
                )}
              </div>

              {/* Расчёт */}
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

                {promoDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Промокод:</span>
                    <span className="font-semibold text-green">
                      -{formatPrice(promoDiscount)}
                    </span>
                  </div>
                )}
              </div>

              {/* Итоговая сумма */}
              <div className="flex justify-between items-center mb-6">
                <span className="text-lg font-bold text-navy">К оплате:</span>
                <span className="text-2xl font-bold text-navy">
                  {formatPrice(finalAmount)}
                </span>
              </div>

              {/* Кнопка оформления */}
              <Button
                variant="primary"
                size="lg"
                onClick={handleCheckout}
                className="w-full"
              >
                Оформить заказ
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

function getProductIcon(type: string): string {
  switch (type) {
    case 'instant':
      return '⚡'
    case 'topup_auto':
      return '📱'
    case 'topup_manual':
      return '💳'
    case 'manual':
      return '📦'
    default:
      return '🎁'
  }
}
