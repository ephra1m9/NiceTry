import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

// GET /api/admin/products/[id] - получение товара
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Отдельный запрос категории — не полагаемся на FK-join (PostgREST schema cache)
    let category: { name: string; slug: string } | null = null
    if (product.category_id) {
      const { data: cat } = await supabase
        .from('categories')
        .select('name, slug')
        .eq('id', product.category_id)
        .maybeSingle()
      if (cat) category = cat
    }

    return NextResponse.json({ product: { ...product, categories: category } })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Колонки таблицы products, которые разрешено обновлять через PATCH.
// Фронт присылает весь объект товара (включая вложенный `categories`, `id`,
// `created_at` и пр.) — без whitelist Supabase падает с ошибкой
// "Could not find the 'categories' column of 'products' in the schema cache".
const PRODUCT_UPDATABLE_COLUMNS = [
  'name',
  'description',
  'type',
  'category_id',
  'price',
  'original_price',
  'stock',
  'is_active',
  'supplier',
  'supplier_service_id',
  'denomination_id',
  'supplier_fields',
  'min_amount',
  'max_amount',
  'image_url',
  'sort_order',
  'region',
] as const

// PATCH /api/admin/products/[id] - обновление товара
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const body = await request.json()

    // Берём только реальные колонки таблицы, игнорируем `categories`/`id`/служебные поля
    const updates: Record<string, any> = {}
    for (const col of PRODUCT_UPDATABLE_COLUMNS) {
      if (col in body) updates[col] = body[col]
    }
    updates.updated_at = new Date().toISOString()

    const { data: product, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ product })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/products/[id] - удаление товара
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
