import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/products/[id]
 * Получить детальную информацию о товаре
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { id } = params

    const { data: product, error } = await supabase
      .from('products')
      .select('*, category:categories(id, name, slug)')
      .eq('id', id)
      .eq('is_active', true)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Product not found' },
          { status: 404 }
        )
      }
      console.error('Error fetching product:', error)
      return NextResponse.json(
        { error: 'Failed to fetch product' },
        { status: 500 }
      )
    }

    // Для instant товаров получаем количество доступных ключей
    if (product.type === 'instant') {
      const { count } = await supabase
        .from('product_keys')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', id)
        .eq('is_used', false)

      product.stock = count || 0
    }

    return NextResponse.json({ product })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
