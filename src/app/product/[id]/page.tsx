'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Product } from '@/types'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Spinner from '@/components/ui/Spinner'
import Breadcrumbs from '@/components/Breadcrumbs'
import { useCart } from '@/hooks/useCart'

export default function ProductPage() {
  const params = useParams()
  const router = useRouter()
  const productId = params.id as string

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [quantity, setQuantity] = useState(1)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [customAmount, setCustomAmount] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Обложка-логотип (Google favicon) может не загрузиться для части доменов — тогда
  // показываем брендовый градиент вместо битой картинки (как фолбэк в PCard).
  const [imgError, setImgError] = useState(false)

  const { addToCart } = useCart()

  useEffect(() => {
    if (!productId) return
    setImgError(false) // сброс фолбэка обложки при переходе на другой товар
    fetch(`/api/products/${productId}`)
      .then((res) => res.json())
      .then((data) => {
        setProduct(data.product || null)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load product:', err)
        setLoading(false)
      })
  }, [productId])

  const handleAddToCart = () => {
    if (!product) return

    if (product.type === 'topup_auto' || product.type === 'topup_manual') {
      const nextErrors: Record<string, string> = {}
      const amount = parseFloat(customAmount)
      if (!amount || amount < (product.min_amount || 0) || amount > (product.max_amount || 0)) {
        nextErrors.amount = `Введите сумму от ${product.min_amount} до ${product.max_amount} ₽`
      }
      if (product.supplier_fields && Array.isArray(product.supplier_fields)) {
        const fields = product.supplier_fields as any[]
        for (const field of fields) {
          if (field.required && !formData[field.key]) {
            nextErrors[field.key] = `Заполните поле «${field.name}»`
          }
        }
      }
      setErrors(nextErrors)
      if (Object.keys(nextErrors).length > 0) return

      addToCart({ product, quantity: 1, customAmount: amount, formData })
    } else {
      addToCart({ product, quantity })
    }

    router.push('/cart')
  }

  if (loading) {
    return (
      <div className="container py-8">
        <Spinner label="Загрузка товара…" />
      </div>
    )
  }

  if (!product) {
    return (
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <svg className="ic" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h3>Товар не найден</h3>
          <p>Возможно, он был снят с продажи. Посмотрите похожие позиции в каталоге.</p>
          <Link href="/catalog" className="btn btn-primary mt-1">Вернуться в каталог</Link>
        </div>
      </div>
    )
  }

  const hasDiscount = product.original_price && product.original_price > product.price
  const discountPercent = hasDiscount
    ? Math.round(((product.original_price! - product.price) / product.original_price!) * 100)
    : 0
  const isOutOfStock = product.type === 'instant' && product.stock != null && product.stock <= 0
  const isTopup = product.type === 'topup_auto' || product.type === 'topup_manual'

  const typeInfo: Record<string, { icon: JSX.Element; text: string }> = {
    instant: {
      icon: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
      text: 'Товар придёт автоматически сразу после оплаты — на странице заказа и в Telegram.',
    },
    topup_auto: {
      icon: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
      text: 'Пополнение выполняется автоматически в течение нескольких минут.',
    },
    topup_manual: {
      icon: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
      text: 'Пополнение обрабатывается вручную в течение 24 часов.',
    },
    manual: {
      icon: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16" /></>,
      text: 'Заказ обрабатывается администратором вручную в течение 24 часов.',
    },
  }

  return (
    <div className="container py-6 sm:py-8">
      <Breadcrumbs
        items={[
          { label: 'Главная', href: '/' },
          { label: 'Каталог', href: '/catalog' },
          ...(product.category
            ? [{ label: product.category.name, href: `/category/${product.category.slug}` }]
            : []),
          { label: product.name },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
        {/* Обложка товара */}
        <div className="card overflow-hidden lg:sticky lg:top-24">
          <div className="relative aspect-[4/3] flex items-end p-5 overflow-hidden">
            {product.image_url && !imgError ? (
              <img
                src={product.image_url}
                alt={product.name}
                onError={() => setImgError(true)}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(135deg, #0f2c4a 0%, #13629f 55%, #1c8ce3 100%)' }}
              />
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.5))' }} />
            <div className="relative z-10">
              {product.category && (
                <div className="text-[11px] uppercase tracking-wide font-semibold text-white/80 mb-1">
                  {product.category.name}
                </div>
              )}
              <div className="text-white font-extrabold text-2xl leading-tight drop-shadow">
                {product.name}
              </div>
            </div>
            {hasDiscount && (
              <span className="badge badge-sale absolute top-3 right-3 z-10">−{discountPercent}%</span>
            )}
          </div>
        </div>

        {/* Информация о товаре */}
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            {product.type === 'instant' && <Badge variant="instant">Моментальная выдача</Badge>}
            {product.type === 'topup_auto' && <Badge variant="instant">Автопополнение</Badge>}
            {product.type === 'topup_manual' && <Badge variant="amber">Ручное пополнение</Badge>}
            {product.type === 'manual' && <Badge variant="amber">Ручная обработка</Badge>}
            {product.type === 'instant' &&
              (isOutOfStock ? (
                <Badge variant="out">Нет в наличии</Badge>
              ) : product.stock && product.stock < 10 ? (
                <Badge variant="amber">Осталось {product.stock}</Badge>
              ) : (
                <Badge variant="stock" dot>В наличии</Badge>
              ))}
          </div>

          <h1 className="mb-3">{product.name}</h1>

          {product.description && <p className="text-muted mb-5">{product.description}</p>}

          {/* Цена */}
          {!isTopup ? (
            <div className="flex items-baseline gap-3 mb-6">
              <span className="text-[34px] leading-none font-extrabold text-navy">{formatPrice(product.price)}</span>
              {hasDiscount && (
                <span className="text-lg text-muted-2 line-through">{formatPrice(product.original_price!)}</span>
              )}
            </div>
          ) : (
            <div className="mb-6">
              <p className="text-sm text-muted mb-1">Диапазон суммы</p>
              <p className="text-xl font-bold text-navy">
                от {formatPrice(product.min_amount || 0)} до {formatPrice(product.max_amount || 0)}
              </p>
            </div>
          )}

          {/* Форма для topup товаров */}
          {isTopup && (
            <div className="card card-pad mb-6">
              <h3 className="mb-4">Заполните данные</h3>

              <div className="mb-4">
                <label className="label" htmlFor="amount">Сумма пополнения *</label>
                <Input
                  id="amount"
                  type="number"
                  placeholder={`От ${product.min_amount} до ${product.max_amount}`}
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value)
                    if (errors.amount) setErrors((p) => ({ ...p, amount: '' }))
                  }}
                  min={product.min_amount}
                  max={product.max_amount}
                  error={!!errors.amount}
                  aria-describedby={errors.amount ? 'amount-err' : undefined}
                />
                {errors.amount && (
                  <p id="amount-err" className="field-error">
                    <svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M12 8v4M12 16h.01M12 3a9 9 0 100 18 9 9 0 000-18z" /></svg>
                    {errors.amount}
                  </p>
                )}
              </div>

              {product.supplier_fields &&
                Array.isArray(product.supplier_fields) &&
                product.supplier_fields.map((field: any) => (
                  <div key={field.key} className="mb-4 last:mb-0">
                    <label className="label" htmlFor={`f-${field.key}`}>
                      {field.name} {field.required && '*'}
                    </label>
                    <Input
                      id={`f-${field.key}`}
                      type={field.type || 'text'}
                      placeholder={field.placeholder || ''}
                      value={formData[field.key] || ''}
                      onChange={(e) => {
                        setFormData({ ...formData, [field.key]: e.target.value })
                        if (errors[field.key]) setErrors((p) => ({ ...p, [field.key]: '' }))
                      }}
                      required={field.required}
                      error={!!errors[field.key]}
                    />
                    {errors[field.key] && (
                      <p className="field-error">
                        <svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M12 8v4M12 16h.01M12 3a9 9 0 100 18 9 9 0 000-18z" /></svg>
                        {errors[field.key]}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* Количество для instant/manual товаров */}
          {!isTopup && (
            <div className="mb-6">
              <label className="label">Количество</label>
              <div className="flex items-center gap-4">
                <div className="quantity">
                  <button
                    type="button"
                    aria-label="Уменьшить"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                  >
                    <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
                  </button>
                  <span className="val" aria-live="polite">{quantity}</span>
                  <button
                    type="button"
                    aria-label="Увеличить"
                    onClick={() => setQuantity(quantity + 1)}
                    disabled={product.type === 'instant' && product.stock !== undefined && quantity >= product.stock}
                  >
                    <svg className="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                </div>
                {product.type === 'instant' && product.stock !== undefined && (
                  <span className="text-sm text-muted-2">в наличии: {product.stock}</span>
                )}
              </div>
            </div>
          )}

          {/* Итоговая цена */}
          {!isTopup && (
            <div className="mb-5 px-4 py-3.5 bg-blue-50 rounded-lg flex justify-between items-center">
              <span className="text-sm text-muted">Итого</span>
              <span className="text-2xl font-extrabold text-navy">{formatPrice(product.price * quantity)}</span>
            </div>
          )}

          {/* Кнопка добавления в корзину */}
          <Button variant="primary" size="lg" onClick={handleAddToCart} disabled={isOutOfStock} block>
            {isOutOfStock ? (
              'Нет в наличии'
            ) : (
              <>
                <svg className="ic ic-sm" viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 12.4a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 7H6" /></svg>
                {isTopup ? 'Добавить в корзину' : 'В корзину'}
              </>
            )}
          </Button>

          {/* Информация о типе товара */}
          {typeInfo[product.type] && (
            <div className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-gray-bg text-sm text-muted">
              <svg className="ic ic-sm mt-0.5 flex-none text-blue-700" viewBox="0 0 24 24">
                {typeInfo[product.type].icon}
              </svg>
              <p>{typeInfo[product.type].text}</p>
            </div>
          )}

          {/* Гарантии-преимущества (паттерн магазинов цифровых товаров) */}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { icon: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />, t: 'Быстрая выдача' },
              { icon: <><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></>, t: 'Безопасно' },
              { icon: <><path d="M21 11.5a8.38 8.38 0 01-9 8.5 8.5 8.5 0 01-3.8-.9L3 20l1.9-5.2A8.5 8.5 0 1121 11.5z" /></>, t: 'Поддержка 24/7' },
            ].map((b, i) => (
              <div key={i} className="rounded-lg border border-border-2 bg-white py-3 px-2">
                <svg className="ic mx-auto mb-1 text-blue-700" viewBox="0 0 24 24">{b.icon}</svg>
                <div className="text-[12px] text-muted font-medium leading-tight">{b.t}</div>
              </div>
            ))}
          </div>
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
