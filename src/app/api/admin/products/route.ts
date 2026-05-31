import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/products - список товаров с фильтрами
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Проверка прав администратора
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Параметры фильтрации
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const type = searchParams.get('type')
    const search = searchParams.get('search')
    const isActive = searchParams.get('is_active')

    let query = supabase
      .from('products')
      .select(`
        *,
        categories (name, slug)
      `)
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

    return NextResponse.json({ products })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/admin/products - создание товара
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Проверка прав администратора
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    const { data: product, error } = await supabase
      .from('products')
      .insert({
        name: body.name,
        description: body.description,
        type: body.type,
        category_id: body.category_id,
        price: body.price,
        original_price: body.original_price,
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
