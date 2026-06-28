'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCart } from '@/hooks/useCart'
import { useUser } from '@/hooks/useUser'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Card from '@/components/ui/Card'
import { BI } from '@/components/ui/BI'
import { formatProductTitle } from '@/lib/utils'

export default function CartPage() {
  const router = useRouter()
  const { items, removeFromCart, updateQuantity, clearCart, totalAmount, promo, applyPromo, clearPromo, promoDiscount } = useCart()
  const { user } = useUser()

  const [promoCode, setPromoCode] = useState(promo?.code ?? '')
  const [promoError, setPromoError] = useState('')
  const [applying, setApplying] = useState(false)
  const promoApplied = !!promo

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return
    setApplying(true)
    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode }),
      })
      const data = await res.json()
      if (res.ok && data.valid) {
        // Сохраняем промокод в корзину (переживёт переход на чекаут). Скидка считается в контексте.
        applyPromo({
          code: promoCode.trim().toUpperCase(),
          discount_type: data.discount_type,
          discount_value: Number(data.discount_value),
        })
        setPromoError('')
      } else {
        setPromoError(data.error || 'Промокод недействителен')
        clearPromo()
      }
    } catch (err) {
      setPromoError('Ошибка проверки промокода')
      clearPromo()
    } finally {
      setApplying(false)
    }
  }

  const statusDiscount = user?.status?.discount_percent
    ? (totalAmount * user.status.discount_percent) / 100
    : 0
  const finalAmount = Math.max(0, totalAmount - statusDiscount - promoDiscount)

  if (items.length === 0) {
    return (
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <BI name="cart3" />
          </div>
          <h3>Корзина пуста</h3>
          <p>Добавьте товары из каталога, чтобы оформить заказ.</p>
          <Link href="/catalog" className="btn btn-primary mt-1">Перейти в каталог</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-6 sm:py-8">
      <h1 className="mb-5 sm:mb-6">Корзина</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6 items-start">
        {/* Список товаров */}
        <div className="lg:col-span-2 space-y-3">
          {items.map((item, index) => (
            <Card key={`${item.product.id}-${index}`} padding={false}>
              <div className="card-pad">
                <div className="flex gap-3 sm:gap-4">
                  {/* Миниатюра */}
                  <Link
                    href={`/product/${item.product.id}`}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden text-white font-extrabold text-xl"
                    style={
                      item.product.image_url
                        ? undefined
                        : { background: 'linear-gradient(135deg,#13629f,#1c8ce3)' }
                    }
                  >
                    {item.product.image_url ? (
                      <img src={item.product.image_url} alt={formatProductTitle(item.product.name)} className="w-full h-full object-cover" />
                    ) : (
                      item.product.name.charAt(0).toUpperCase()
                    )}
                  </Link>

                  {/* Информация */}
                  <div className="flex-1 min-w-0">
                    <Link href={`/product/${item.product.id}`} className="font-semibold text-navy hover:text-blue-700 transition-colors line-clamp-2">
                      {formatProductTitle(item.product.name)}
                    </Link>

                    {item.customAmount ? (
                      <div className="text-sm text-muted space-y-0.5 mt-1">
                        <p>Сумма: {formatPrice(item.customAmount)}</p>
                        {item.formData &&
                          Object.entries(item.formData).map(([key, value]) => (
                            <p key={key} className="truncate">{key}: {value}</p>
                          ))}
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-muted mt-0.5 mb-2">
                          {formatPrice(item.product.price)} × {item.quantity}
                        </p>
                        <div className="quantity">
                          <button
                            type="button"
                            aria-label="Уменьшить"
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                          >
                            <BI name="dash-lg" />
                          </button>
                          <span className="val">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label="Увеличить"
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                          >
                            <BI name="plus-lg" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Цена и удаление */}
                  <div className="text-right flex flex-col justify-between items-end flex-none">
                    <p className="font-bold text-navy whitespace-nowrap">
                      {formatPrice(item.customAmount || item.product.price * item.quantity)}
                    </p>
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="iconbtn !w-9 !h-9 !text-muted-2 hover:!text-red hover:!border-red/30"
                      aria-label="Удалить из корзины"
                      title="Удалить"
                    >
                      <BI name="trash3" size="sm" />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}

          <button
            onClick={clearCart}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-red transition-colors px-1 py-1"
          >
            <BI name="trash3" size="sm" />
            Очистить корзину
          </button>
        </div>

        {/* Итого */}
        <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-24" padding={false}>
            <div className="card-pad">
              <h2 className="mb-4">Итого</h2>

              {/* Промокод */}
              <div className="mb-4">
                <label className="label" htmlFor="promo">Промокод</label>
                <div className="flex gap-2">
                  <Input
                    id="promo"
                    type="text"
                    placeholder="Введите промокод"
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value.toUpperCase())
                      setPromoError('')
                    }}
                    error={!!promoError}
                  />
                  <Button variant="secondary" onClick={handleApplyPromo} loading={applying} disabled={!promoCode.trim()}>
                    ОК
                  </Button>
                </div>
                {promoError && (
                  <p className="field-error">
                    <BI name="info-circle" size="sm" />
                    {promoError}
                  </p>
                )}
                {promoApplied && !promoError && (
                  <p className="mt-1.5 text-[12.5px] text-green font-medium flex items-center gap-1.5">
                    <BI name="check-lg" size="sm" />
                    Промокод применён
                  </p>
                )}
              </div>

              {/* Расчёт */}
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
                    <span className="text-muted">Промокод</span>
                    <span className="font-semibold text-green">−{formatPrice(promoDiscount)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mb-5">
                <span className="text-lg font-bold text-navy">К оплате</span>
                <span className="text-2xl font-extrabold text-navy">{formatPrice(finalAmount)}</span>
              </div>

              <Button variant="primary" size="lg" onClick={() => router.push('/checkout')} block>
                Оформить заказ
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
