'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Product } from '@/types'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
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

  const { addToCart } = useCart()

  useEffect(() => {
    if (!productId) return

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

    // Валидация для topup товаров
    if (product.type === 'topup_auto' || product.type === 'topup_manual') {
      const amount = parseFloat(customAmount)
      if (!amount || amount < (product.min_amount || 0) || amount > (product.max_amount || 0)) {
        alert(`Введите сумму от ${product.min_amount} до ${product.max_amount} ₽`)
        return
      }

      // Проверка обязательных полей
      if (product.supplier_fields) {
        const fields = product.supplier_fields as any[]
        for (const field of fields) {
          if (field.required && !formData[field.name]) {
            alert(`Заполните поле: ${field.label}`)
            return
          }
        }
      }

      addToCart({
        product,
        quantity: 1,
        customAmount: amount,
        formData,
      })
    } else {
      // Для instant и manual товаров
      addToCart({
        product,
        quantity,
      })
    }

    router.push('/cart')
  }

  if (loading) {
    return (
      <div className="container py-12 text-center">
        <div className="inline-block w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin"></div>
        <p className="text-muted mt-4">Загрузка...</p>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="container py-12 text-center">
        <h1 className="text-2xl font-bold text-navy mb-4">Товар не найден</h1>
        <Link href="/catalog" className="text-blue hover:underline">
          Вернуться в каталог
        </Link>
      </div>
    )
  }

  const hasDiscount = product.original_price && product.original_price > product.price
  const discountPercent = hasDiscount
    ? Math.round(((product.original_price! - product.price) / product.original_price!) * 100)
    : 0

  const isOutOfStock = product.type === 'instant' && product.stock !== undefined && product.stock <= 0

  return (
    <div className="container py-8">
      {/* Хлебные крошки */}
      <div className="text-sm text-muted mb-6">
        <Link href="/" className="hover:text-blue">
          Главная
        </Link>
        {' / '}
        <Link href="/catalog" className="hover:text-blue">
          Каталог
        </Link>
        {product.category && (
          <>
            {' / '}
            <Link
              href={`/category/${product.category.slug}`}
              className="hover:text-blue"
            >
              {product.category.name}
            </Link>
          </>
        )}
        {' / '}
        <span className="text-navy">{product.name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Изображение товара */}
        <div>
          <div className="card card-pad">
            <div className="relative bg-gray-50 rounded-lg aspect-square flex items-center justify-center overflow-hidden">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-8xl text-gray-300">
                  {getProductIcon(product.type)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Информация о товаре */}
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {product.type === 'instant' && (
              <Badge variant="instant">Моментальная выдача</Badge>
            )}
            {product.type === 'topup_auto' && (
              <Badge variant="instant">Автопополнение</Badge>
            )}
            {product.type === 'topup_manual' && (
              <Badge variant="amber">Ручное пополнение</Badge>
            )}
            {product.type === 'manual' && (
              <Badge variant="amber">Ручная обработка</Badge>
            )}
            {hasDiscount && <Badge variant="sale">-{discountPercent}%</Badge>}
            {product.type === 'instant' && (
              <>
                {isOutOfStock ? (
                  <Badge variant="out">Нет в наличии</Badge>
                ) : product.stock && product.stock < 10 ? (
                  <Badge variant="amber">Осталось {product.stock}</Badge>
                ) : (
                  <Badge variant="stock">В наличии</Badge>
                )}
              </>
            )}
          </div>

          <h1 className="text-3xl font-bold text-navy mb-4">{product.name}</h1>

          {product.description && (
            <p className="text-muted mb-6">{product.description}</p>
          )}

          {/* Цена */}
          {product.type === 'instant' || product.type === 'manual' ? (
            <div className="mb-6">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-navy">
                  {formatPrice(product.price)}
                </span>
                {hasDiscount && (
                  <span className="text-xl text-muted line-through">
                    {formatPrice(product.original_price!)}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <p className="text-sm text-muted mb-2">Диапазон суммы:</p>
              <p className="text-lg font-semibold text-navy">
                От {formatPrice(product.min_amount || 0)} до{' '}
                {formatPrice(product.max_amount || 0)}
              </p>
            </div>
          )}

          {/* Форма для topup товаров */}
          {(product.type === 'topup_auto' || product.type === 'topup_manual') && (
            <div className="card card-pad mb-6">
              <h3 className="font-semibold text-navy mb-4">Заполните данные</h3>

              {/* Сумма пополнения */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-navy mb-2">
                  Сумма пополнения *
                </label>
                <Input
                  type="number"
                  placeholder={`От ${product.min_amount} до ${product.max_amount}`}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  min={product.min_amount}
                  max={product.max_amount}
                />
              </div>

              {/* Дополнительные поля */}
              {product.supplier_fields &&
                Array.isArray(product.supplier_fields) &&
                product.supplier_fields.map((field: any) => (
                  <div key={field.name} className="mb-4">
                    <label className="block text-sm font-semibold text-navy mb-2">
                      {field.label} {field.required && '*'}
                    </label>
                    <Input
                      type={field.type || 'text'}
                      placeholder={field.placeholder || ''}
                      value={formData[field.name] || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, [field.name]: e.target.value })
                      }
                      required={field.required}
                    />
                  </div>
                ))}
            </div>
          )}

          {/* Количество для instant/manual товаров */}
          {(product.type === 'instant' || product.type === 'manual') && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-navy mb-2">
                Количество
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 border border-border rounded hover:bg-gray-50 transition-colors"
                  disabled={quantity <= 1}
                >
                  −
                </button>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  className="w-20 text-center"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 border border-border rounded hover:bg-gray-50 transition-colors"
                  disabled={product.type === 'instant' && product.stock !== undefined && quantity >= product.stock}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Итоговая цена */}
          {(product.type === 'instant' || product.type === 'manual') && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Итого:</span>
                <span className="text-2xl font-bold text-navy">
                  {formatPrice(product.price * quantity)}
                </span>
              </div>
            </div>
          )}

          {/* Кнопка добавления в корзину */}
          <Button
            variant="primary"
            size="lg"
            onClick={handleAddToCart}
            disabled={isOutOfStock}
            className="w-full"
          >
            {isOutOfStock ? 'Нет в наличии' : 'Добавить в корзину'}
          </Button>

          {/* Информация о типе товара */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-muted">
            {product.type === 'instant' && (
              <p>
                ⚡ Товар будет доставлен автоматически сразу после оплаты
              </p>
            )}
            {product.type === 'topup_auto' && (
              <p>
                📱 Пополнение будет выполнено автоматически в течение нескольких минут
              </p>
            )}
            {product.type === 'topup_manual' && (
              <p>
                💳 Пополнение будет обработано вручную в течение 24 часов
              </p>
            )}
            {product.type === 'manual' && (
              <p>
                📦 Заказ будет обработан вручную администратором в течение 24 часов
              </p>
            )}
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
