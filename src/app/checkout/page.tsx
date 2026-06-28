'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCart } from '@/hooks/useCart'
import { useUser } from '@/hooks/useUser'
import { useAuth } from '@/hooks/useAuth'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { BI } from '@/components/ui/BI'
import Alert from '@/components/ui/Alert'
import Input from '@/components/ui/Input'
import { NICKNAME_MIN, NICKNAME_MAX } from '@/lib/auth/nickname'
import { formatProductTitle } from '@/lib/utils'

// Гостевой чекаут на ЗАГЛУШКЕ оплаты (PAYMENTS_MODE=mock):
//   шаг 'form'     — почта + способ оплаты → оплатить;
//   шаг 'nickname' — после DEMO-оплаты новый гость придумывает ник → авто-вход → ЛК;
//   шаг 'existing' — на почту уже есть аккаунт → предложить вход по коду.
// Оплата с баланса (для залогиненных) идёт прежним путём /api/orders/create без изменений.

type Step = 'form' | 'nickname' | 'existing'
type PaymentMethod = 'balance' | 'mock'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function CheckoutPage() {
  const router = useRouter()
  const { user: authUser } = useAuth()
  const { user } = useUser()
  const { items, totalAmount, clearCart, promo, promoDiscount } = useCart()

  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mock')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  // Данные созданного гостевого заказа (для шага ника / привязки).
  const [pending, setPending] = useState<{ orderId: string; token: string; email: string } | null>(null)

  // Предзаполняем почту из аккаунта при активной сессии (и блокируем поле).
  useEffect(() => {
    if (user?.email) setEmail(user.email)
  }, [user?.email])

  // Залогиненный по умолчанию платит с баланса; гость — DEMO-картой.
  useEffect(() => {
    setPaymentMethod(authUser ? 'balance' : 'mock')
  }, [authUser])

  const statusDiscount = user?.status?.discount_percent
    ? (totalAmount * user.status.discount_percent) / 100
    : 0
  const finalAmount = Math.max(0, totalAmount - statusDiscount - promoDiscount)
  const insufficient = paymentMethod === 'balance' && !!user && user.balance < finalAmount
  const emailLocked = !!authUser

  // ——— Оплата ———
  const handleSubmit = async () => {
    if (items.length === 0) {
      router.push('/cart')
      return
    }
    setError('')

    // Оплата с баланса — прежний поток (только для залогиненных).
    if (paymentMethod === 'balance') {
      if (!authUser) {
        router.push('/auth/login?redirect=/checkout')
        return
      }
      if (user && user.balance < finalAmount) {
        setError('Недостаточно средств на балансе')
        return
      }
      setProcessing(true)
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
            payment_method: 'balance',
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
      } catch {
        setError('Произошла ошибка при оформлении заказа')
        setProcessing(false)
      }
      return
    }

    // DEMO-оплата (mock) — гостевой поток.
    if (!emailLocked && !EMAIL_RE.test(email.trim())) {
      setError('Укажите корректный email для получения')
      return
    }
    setProcessing(true)
    try {
      const res = await fetch('/api/checkout/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          items: items.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            price: item.customAmount || item.product.price,
            custom_amount: item.customAmount,
            form_data: item.formData,
          })),
          promo_code: promo?.code,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || 'Не удалось оформить заказ')
        setProcessing(false)
        return
      }
      clearCart()
      // БОЕВОЙ режим: платёж асинхронный. Если pay4game вернул готовую платёжную страницу
      // (sbp_type=url / card / sberpay) — уводим на неё; после оплаты вернёт на return_url
      // (/pay/return/[invoice_id]), где статус опросится и заказ доведётся до выдачи.
      // Если url нет — фолбэк на встроенную страницу ожидания с QR из вебхука inform.
      if (data.mode === 'live') {
        if (data.url) {
          window.location.href = data.url
          return
        }
        if (data.pay_url) {
          router.push(data.pay_url)
          return
        }
      }
      if (data.flow === 'session') {
        // Сессия активна — заказ уже в аккаунте, ник не нужен.
        router.push(`/orders/${data.order.id}`)
        return
      }
      if (data.flow === 'existing') {
        // На эту почту уже есть аккаунт — заказ привязан, предлагаем вход по коду.
        setStep('existing')
        setProcessing(false)
        return
      }
      // Новый гость — шаг ника.
      setPending({ orderId: data.order.id, token: data.token, email: data.email })
      setStep('nickname')
      setProcessing(false)
    } catch {
      setError('Произошла ошибка при оформлении заказа')
      setProcessing(false)
    }
  }

  // ——— Шаг ника (live-проверка свободен/занят) ———
  const [nickname, setNickname] = useState('')
  const [nickState, setNickState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle')
  const [nickError, setNickError] = useState('')
  const nickAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    if (step !== 'nickname') return
    const value = nickname.trim()
    if (!value) {
      setNickState('idle')
      setNickError('')
      return
    }
    setNickState('checking')
    setNickError('')
    const handle = setTimeout(async () => {
      nickAbort.current?.abort()
      const ctrl = new AbortController()
      nickAbort.current = ctrl
      try {
        const res = await fetch(`/api/user/nickname/check?nickname=${encodeURIComponent(value)}`, {
          signal: ctrl.signal,
        })
        const data = await res.json()
        if (!data.valid) {
          setNickState('invalid')
          setNickError(data.error || 'Недопустимый ник')
        } else {
          setNickState(data.available ? 'free' : 'taken')
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setNickState('idle')
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [nickname, step])

  const handleFinalize = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pending || nickState !== 'free') return
    setProcessing(true)
    setError('')
    try {
      const res = await fetch('/api/checkout/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: pending.orderId,
          token: pending.token,
          nickname: nickname.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        if (res.status === 409) setNickState('taken')
        setError(data.error || 'Не удалось завершить оформление')
        setProcessing(false)
        return
      }
      // Авто-вход выполнен сервером (cookies). Идём в личный кабинет.
      window.location.href = '/profile'
    } catch {
      setError('Ошибка сети')
      setProcessing(false)
    }
  }

  // ——— Пустая корзина ———
  if (items.length === 0 && step === 'form') {
    return (
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <BI name="cart3" />
          </div>
          <h3>Корзина пуста</h3>
          <p>Добавьте товары в корзину перед оформлением заказа.</p>
          <Link href="/catalog" className="btn btn-primary mt-1">Перейти в каталог</Link>
        </div>
      </div>
    )
  }

  // ——— Шаг: на почту уже есть аккаунт ———
  if (step === 'existing') {
    return (
      <div className="container py-12 flex justify-center">
        <div className="card card-pad max-w-md w-full text-center">
          <div className="alert alert-success mb-4 text-left">
            <BI name="check-lg" size="sm" />
            <div>
              <div className="font-semibold">Оплата прошла</div>
              <p className="text-[13px] opacity-90 mt-0.5">Заказ оформлен и привязан к вашему аккаунту.</p>
            </div>
          </div>
          <h2 className="mb-2">У вас уже есть аккаунт</h2>
          <p className="text-muted text-sm mb-5">
            На почту <b>{email}</b> уже зарегистрирован аккаунт. Войдите по коду, чтобы увидеть заказ
            и историю покупок.
          </p>
          <Link
            href={`/auth/login?redirect=/profile&identifier=${encodeURIComponent(email)}`}
            className="btn btn-primary btn-lg w-full"
          >
            Войти по коду
          </Link>
        </div>
      </div>
    )
  }

  // ——— Шаг: придумайте ник (после DEMO-оплаты) ———
  if (step === 'nickname') {
    return (
      <div className="container py-12 flex justify-center">
        <div className="card card-pad max-w-md w-full">
          <div className="alert alert-success mb-5">
            <BI name="check-lg" size="sm" />
            <div>
              <div className="font-semibold">Оплата прошла</div>
              <p className="text-[13px] opacity-90 mt-0.5">
                Заказ оформлен на {pending?.email}.
              </p>
            </div>
          </div>

          <div className="text-center mb-5">
            <h1 className="text-[22px]">Придумайте никнейм</h1>
            <p className="text-muted text-sm mt-1.5">Создадим аккаунт на вашу почту и сохраним заказ</p>
          </div>

          <form onSubmit={handleFinalize} className="space-y-4">
            <div>
              <label htmlFor="nickname" className="label">Никнейм</label>
              <Input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="например, player_01"
                required
                disabled={processing}
                autoComplete="off"
                error={nickState === 'taken' || nickState === 'invalid'}
              />
              <div className="mt-1.5 text-[13px] min-h-[18px]">
                {nickState === 'checking' && <span className="text-muted-2">Проверяем…</span>}
                {nickState === 'free' && <span className="text-green-600"><i className="bi bi-check-lg" aria-hidden="true" /> Ник свободен</span>}
                {nickState === 'taken' && <span className="text-red-600">Этот ник уже занят</span>}
                {nickState === 'invalid' && <span className="text-red-600">{nickError}</span>}
                {nickState === 'idle' && (
                  <span className="text-muted-2">
                    Латиница, цифры, _ и -, от {NICKNAME_MIN} до {NICKNAME_MAX} символов
                  </span>
                )}
              </div>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <Button type="submit" variant="primary" size="lg" loading={processing} block disabled={nickState !== 'free'}>
              Продолжить
            </Button>
          </form>
        </div>
      </div>
    )
  }

  // ——— Шаг: форма чекаута ———
  return (
    <div className="container py-6 sm:py-8">
      <h1 className="mb-5 sm:mb-6">Оформление заказа</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6 items-start">
        <div className="lg:col-span-2 space-y-5">
          {/* Email для получения */}
          <Card padding={false}>
            <div className="card-pad">
              <h2 className="mb-4">Email для получения</h2>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                disabled={processing || emailLocked}
                autoComplete="email"
              />
              <p className="text-sm text-muted mt-2">
                {emailLocked
                  ? 'Заказ будет сохранён в вашем аккаунте.'
                  : 'На эту почту привяжем заказ. После оплаты придумаете ник — аккаунт создадим автоматически, без кода.'}
              </p>
            </div>
          </Card>

          {/* Способ оплаты */}
          <Card padding={false}>
            <div className="card-pad">
              <h2 className="mb-4">Способ оплаты</h2>
              <div className="space-y-3">
                {/* Баланс — только для залогиненных */}
                {authUser && (
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
                      onChange={() => setPaymentMethod('balance')}
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
                )}

                {/* DEMO-оплата (mock) */}
                <label
                  className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                    paymentMethod === 'mock' ? 'border-blue bg-blue-50/60 ring-1 ring-blue/30' : 'border-border hover:border-blue-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="mock"
                    checked={paymentMethod === 'mock'}
                    onChange={() => setPaymentMethod('mock')}
                    className="radio mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-navy mb-0.5">
                      Оплата картой
                    </div>
                    <div className="text-sm text-muted">
                      Безопасная оплата банковской картой.
                    </div>
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
                      <div className="font-semibold text-navy truncate">{formatProductTitle(item.product.name)}</div>
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

              <Button
                variant="primary"
                size="lg"
                onClick={handleSubmit}
                loading={processing}
                disabled={insufficient}
                block
              >
                {paymentMethod === 'mock' ? 'Оплатить' : 'Оплатить'}
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
