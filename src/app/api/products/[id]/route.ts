import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildCatalogProducts } from '@/lib/catalog'

/**
 * GET /api/products/[id]
 * Детальная карточка товара. Фолбэк на сгенерированный каталог, если БД пуста/недоступна
 * (id в фолбэк-режиме = denomination_id / id игры / manual-slug).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  try {
    const supabase = await createClient()

    const { data: product, error } = await supabase
      .from('products')
      .select('*, category:categories(id, name, slug)')
      .eq('id', id)
      .eq('is_active', true)
      .single()

    if (error || !product) {
      return fallbackProduct(id)
    }

    // Остаток instant-товара считаем по product_keys ТОЛЬКО для локальных ключей.
    // Supplier-товары (approute/dessly) ключей в product_keys не держат: approute выдаёт
    // ваучеры вживую (createShopOrder→unhideVouchers), dessly шлёт гифт. Их остаток
    // синхронизируется в колонку products.stock (approute: inStock от поставщика) — её и
    // оставляем. Иначе count=0 ложно показывал «нет в наличии», расходясь со списком
    // /api/products (который отдаёт products.stock как есть).
    if (product.type === 'instant' && product.supplier !== 'approute' && product.supplier !== 'dessly') {
      const { count } = await supabase
        .from('product_keys')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', id)
        .eq('is_used', false)
      product.stock = count || 0
    }

    return NextResponse.json({ product })
  } catch (error) {
    console.error('[product] DB unavailable, using fallback:', error)
    return fallbackProduct(id)
  }
}

async function fallbackProduct(id: string) {
  try {
    const products = await buildCatalogProducts()
    const product = products.find((p) => p.id === id)
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }
    return NextResponse.json({ product, source: 'catalog-fallback' })
  } catch (e) {
    console.error('[product] fallback failed:', e)
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
}
