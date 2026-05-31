import Link from 'next/link'
import { Product } from '@/types'
import Badge from './ui/Badge'
import Card from './ui/Card'

interface ProductCardProps {
  product: Product & { category?: { name: string; slug: string } }
}

export function ProductCard({ product }: ProductCardProps) {
  const hasDiscount = product.original_price && product.original_price > product.price
  const discountPercent = hasDiscount
    ? Math.round(((product.original_price! - product.price) / product.original_price!) * 100)
    : 0

  const isOutOfStock = product.type === 'instant' && product.stock !== undefined && product.stock <= 0

  return (
    <Link href={`/product/${product.id}`}>
      <Card className="h-full hover:shadow-md transition-shadow duration-200 cursor-pointer">
        <div className="card-pad flex flex-col h-full">
          {/* Изображение товара */}
          <div className="relative mb-3 bg-gray-50 rounded-lg aspect-[4/3] flex items-center justify-center overflow-hidden">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-4xl text-gray-300">
                {getProductIcon(product.type)}
              </div>
            )}

            {/* Бейджи */}
            <div className="absolute top-2 left-2 flex flex-col gap-1">
              {product.type === 'instant' && (
                <Badge variant="instant">Моментально</Badge>
              )}
              {hasDiscount && (
                <Badge variant="sale">-{discountPercent}%</Badge>
              )}
            </div>

            {/* Статус наличия */}
            {product.type === 'instant' && (
              <div className="absolute bottom-2 right-2">
                {isOutOfStock ? (
                  <Badge variant="out">Нет в наличии</Badge>
                ) : product.stock && product.stock < 10 ? (
                  <Badge variant="amber">Осталось {product.stock}</Badge>
                ) : (
                  <Badge variant="stock">В наличии</Badge>
                )}
              </div>
            )}
          </div>

          {/* Информация о товаре */}
          <div className="flex-1 flex flex-col">
            {/* Категория */}
            {product.category && (
              <div className="text-xs text-muted mb-1">
                {product.category.name}
              </div>
            )}

            {/* Название */}
            <h3 className="text-[15px] font-semibold text-navy mb-2 line-clamp-2">
              {product.name}
            </h3>

            {/* Описание */}
            {product.description && (
              <p className="text-sm text-muted mb-3 line-clamp-2 flex-1">
                {product.description}
              </p>
            )}

            {/* Цена */}
            <div className="flex items-baseline gap-2 mt-auto">
              <span className="text-xl font-bold text-navy">
                {formatPrice(product.price)}
              </span>
              {hasDiscount && (
                <span className="text-sm text-muted line-through">
                  {formatPrice(product.original_price!)}
                </span>
              )}
            </div>

            {/* Диапазон для topup */}
            {(product.type === 'topup_auto' || product.type === 'topup_manual') &&
              product.min_amount &&
              product.max_amount && (
                <div className="text-xs text-muted mt-1">
                  От {formatPrice(product.min_amount)} до {formatPrice(product.max_amount)}
                </div>
              )}
          </div>
        </div>
      </Card>
    </Link>
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
