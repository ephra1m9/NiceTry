import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

// GET /api/admin/products - список товаров с фильтрами
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    // Параметры фильтрации
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const type = searchParams.get('type')
    const search = searchParams.get('search')
    const isActive = searchParams.get('is_active')

    // Не полагаемся на FK-embed (`categories (...)`) — PostgREST schema cache
    // в этом деплое его не находит. Берём товары, затем мапим категории отдельным запросом.
    let query = supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })

    if (category) {
      query = query.eq('category_id', category)
    }

    if (type) {
      query = query.eq('type', type)
    }

    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    if (isActive !== null && isActive !== undefined) {
      query = query.eq('is_active', isActive === 'true')
    }

    const { data: products, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Подмешиваем категорию (name, slug) одним запросом по всем category_id
    const categoryIds = Array.from(
      new Set((products || []).map((p: any) => p.category_id).filter(Boolean))
    )
    const categoryMap: Record<string, { name: string; slug: string }> = {}
    if (categoryIds.length > 0) {
      const { data: cats } = await supabase
        .from('categories')
        .select('id, name, slug')
        .in('id', categoryIds)
      for (const c of cats || []) {
        categoryMap[c.id] = { name: c.name, slug: c.slug }
      }
    }
    const withCategories = (products || []).map((p: any) => ({
      ...p,
      categories: p.category_id ? categoryMap[p.category_id] || null : null,
    }))

    return NextResponse.json({ products: withCategories })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/admin/products - создание товара
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const body = await request.json()

    // Применяем наценку категории: price в БД всегда хранится как итоговая цена с наценкой.
    let finalPrice = body.price
    let finalOriginalPrice = body.original_price
    if (body.category_id && body.price > 0) {
      const { data: cat } = await supabase
        .from('categories')
        .select('markup_percent')
        .eq('id', body.category_id)
        .single()
      const markup = Number(cat?.markup_percent ?? 0)
      if (markup > 0) {
        const factor = (100 + markup) / 100
        finalPrice = Math.ceil(body.price * factor)
        if (body.original_price > 0) finalOriginalPrice = Math.ceil(body.original_price * factor)
      }
    }

    const { data: product, error } = await supabase
      .from('products')
      .insert({
        name: body.name,
        description: body.description,
        type: body.type,
        category_id: body.category_id,
        price: finalPrice,
        original_price: finalOriginalPrice,
        stock: body.stock,
        is_active: body.is_active ?? true,
        supplier: body.supplier,
        supplier_service_id: body.supplier_service_id,
        denomination_id: body.denomination_id,
        supplier_fields: body.supplier_fields,
        min_amount: body.min_amount,
        max_amount: body.max_amount,
        image_url: body.image_url,
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ product }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
