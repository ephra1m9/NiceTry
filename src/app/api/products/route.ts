import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * GET /api/products
 * Получить список товаров с фильтрами
 * Query params:
 * - category_id: UUID категории
 * - type: instant | topup_auto | topup_manual | manual
 * - supplier: approute | dessly
 * - min_price: минимальная цена
 * - max_price: максимальная цена
 * - search: поиск по названию
 * - limit: количество товаров (по умолчанию 50)
 * - offset: смещение для пагинации
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const searchParams = request.nextUrl.searchParams

    const categoryId = searchParams.get('category_id')
    const type = searchParams.get('type')
    const supplier = searchParams.get('supplier')
    const minPrice = searchParams.get('min_price')
    const maxPrice = searchParams.get('max_price')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = supabase
      .from('products')
      .select('*, category:categories(id, name, slug)', { count: 'exact' })
      .eq('is_active', true)

    // Фильтры
    if (categoryId) {
      query = query.eq('category_id', categoryId)
    }

    if (type) {
      query = query.eq('type', type)
    }

    if (supplier) {
      query = query.eq('supplier', supplier)
    }

    if (minPrice) {
      query = query.gte('price', parseFloat(minPrice))
    }

    if (maxPrice) {
      query = query.lte('price', parseFloat(maxPrice))
    }

    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    // Сортировка и пагинация
    query = query
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: products, error, count } = await query

    if (error) {
      console.error('Error fetching products:', error)
      return NextResponse.json(
        { error: 'Failed to fetch products' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      products,
      total: count || 0,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
