import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildCatalogProducts, priceRub } from '@/lib/catalog'

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

    // Сначала ищем по первичному ключу (UUID), затем по denomination_id —
    // ссылки из фолбэк-каталога содержат denomination_id, а не UUID.
    let { data: product, error } = await supabase
      .from('products')
      .select('*, category:categories(id, name, slug, default_image_url)')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle()

    if (!product) {
      const res = await supabase
        .from('products')
        .select('*, category:categories(id, name, slug, default_image_url)')
        .eq('denomination_id', id)
        .eq('is_active', true)
        .maybeSingle()
      product = res.data
      error = res.error
    }

    if (error || !product) {
      return fallbackProduct(id)
    }

    // Игры Dessly убраны из каталога — карточка недоступна, покупка только через /send-game.
    if (product.supplier === 'dessly') {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
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

    if (!product.image_url && product.category?.default_image_url) {
      product.image_url = product.category.default_image_url
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
    // Игры Dessly недоступны как карточка каталога — только через /send-game.
    if (!product || product.supplier === 'dessly') {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Пересчитываем цену по актуальной наценке/курсу из БД.
    let finalProduct = product
    try {
      const supabase = await createClient()
      const slug = product.category?.slug
      const priceUsd = (product as any).price_usd as number | undefined
      if (slug && priceUsd && priceUsd > 0) {
        const { data: cat } = await supabase
          .from('categories')
          .select('usd_to_rub_rate, markup_percent')
          .eq('slug', slug)
          .maybeSingle()
        if (cat && Number(cat.usd_to_rub_rate) > 0) {
          finalProduct = { ...product, price: priceRub(priceUsd, Number(cat.usd_to_rub_rate), Number(cat.markup_percent ?? 0)) }
        }
      }
    } catch { /* оставляем статическую цену если БД недоступна */ }

    return NextResponse.json({ product: finalProduct, source: 'catalog-fallback' })
  } catch (e) {
    console.error('[product] fallback failed:', e)
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
}
