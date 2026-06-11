import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildCatalogProducts } from '@/lib/catalog'
import type { Product } from '@/types'

/**
 * GET /api/products
 * Список товаров с фильтрами. Источник — таблица products (Supabase).
 * Если БД пуста/недоступна, отдаётся сгенерированный каталог из поставщиков (мок→боевой),
 * чтобы витрина была наполнена сразу. Query: category_id, type, supplier, min_price,
 * max_price, search, limit, offset, а также мульти-фильтры групп шапки:
 * cats (slug'и категорий через запятую) и types (типы товаров через запятую).
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const categoryId = searchParams.get('category_id')
  const cats = splitCsv(searchParams.get('cats'))
  const types = splitCsv(searchParams.get('types'))
  const type = searchParams.get('type')
  const supplier = searchParams.get('supplier')
  const minPrice = searchParams.get('min_price')
  const maxPrice = searchParams.get('max_price')
  const search = searchParams.get('search')
  const region = searchParams.get('region')
  const limit = clampInt(searchParams.get('limit'), 50, 1, 200)
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100000)

  try {
    const supabase = await createClient()

    // Не полагаемся на FK-embed (`category:categories(...)`): если PostgREST
    // schema cache его не находит, весь запрос падает с ошибкой и витрина уходит
    // в фолбэк-каталог, ломая фильтр по категориям. Берём товары, затем мапим
    // категории отдельным запросом.
    let query = supabase
      .from('products')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      // Игры Dessly убраны из общего каталога — покупка только через /send-game.
      .neq('supplier', 'dessly')

    if (categoryId) query = query.eq('category_id', categoryId)
    // Группы шапки: cats — slug'и категорий. category_id в товарах — uuid,
    // поэтому сперва переводим slug'и в id отдельным запросом.
    if (cats.length > 0) {
      const { data: groupCats } = await supabase
        .from('categories')
        .select('id')
        .in('slug', cats)
      const ids = (groupCats || []).map((c: any) => c.id)
      // Нет таких категорий в БД — отдаём пустой результат, а не весь каталог.
      query = query.in('category_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
    }
    if (types.length > 0) query = query.in('type', types)
    if (type) query = query.eq('type', type)
    if (supplier) query = query.eq('supplier', supplier)
    if (minPrice) query = query.gte('price', parseFloat(minPrice))
    if (maxPrice) query = query.lte('price', parseFloat(maxPrice))
    if (search) query = query.ilike('name', `%${search}%`)
    if (region) query = query.eq('region', region)

    // Миксуем каталог по id (gen_random_uuid — стабильно случаен). Иначе товары идут группами
    // по бренду (sort_order = порядок фида AppRoute: сначала все ~323 Apple-карты, затем все
    // Steam и т.д.), и первые страницы оказываются «чисто Apple». id — первичный ключ, поэтому
    // порядок стабилен между страницами (пагинация limit/offset не плодит дубли/пропуски).
    query = query
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1)

    const { data: products, error, count } = await query

    if (!error && products && products.length > 0) {
      // Подмешиваем категорию (id, name, slug) одним запросом
      const categoryIds = Array.from(
        new Set(products.map((p: any) => p.category_id).filter(Boolean))
      )
      const categoryMap: Record<string, { id: string; name: string; slug: string }> = {}
      if (categoryIds.length > 0) {
        const { data: cats } = await supabase
          .from('categories')
          .select('id, name, slug')
          .in('id', categoryIds)
        for (const c of cats || []) categoryMap[c.id] = c
      }
      const withCategories = products.map((p: any) => ({
        ...p,
        category: p.category_id ? categoryMap[p.category_id] || null : null,
      }))
      return NextResponse.json({ products: withCategories, total: count || products.length, limit, offset })
    }
    // Пустая БД или ошибка — фолбэк на сгенерированный каталог.
    // Если categoryId — UUID из таблицы categories, разрешаем его в slug: в fallback-каталоге
    // товары хранятся с category_id = slug, а не UUID, иначе фильтр по категории не сработает.
    const fallbackCatId = await resolveToSlug(supabase, categoryId)
    return fallbackResponse({ categoryId: fallbackCatId, cats, types, type, supplier, minPrice, maxPrice, search, region, limit, offset })
  } catch (error) {
    console.error('[products] DB unavailable, using catalog fallback:', error)
    return fallbackResponse({ categoryId, cats, types, type, supplier, minPrice, maxPrice, search, region, limit, offset })
  }
}

/** Если id выглядит как UUID — пробует получить slug из таблицы categories. Иначе возвращает as-is. */
async function resolveToSlug(supabase: any, id: string | null): Promise<string | null> {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id
  try {
    const { data } = await supabase.from('categories').select('slug').eq('id', id).maybeSingle()
    return data?.slug ?? id
  } catch {
    return id
  }
}

interface FilterArgs {
  categoryId: string | null
  cats: string[]
  types: string[]
  type: string | null
  supplier: string | null
  minPrice: string | null
  maxPrice: string | null
  search: string | null
  region: string | null
  limit: number
  offset: number
}

async function fallbackResponse(f: FilterArgs) {
  try {
    let products = await buildCatalogProducts()
    products = applyFilters(products, f)
    // Тот же микс по id, что и в боевом пути (иначе фолбэк идёт группами по бренду).
    products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const total = products.length
    const paged = products.slice(f.offset, f.offset + f.limit)
    return NextResponse.json({ products: paged, total, limit: f.limit, offset: f.offset, source: 'catalog-fallback' })
  } catch (e) {
    console.error('[products] fallback failed:', e)
    return NextResponse.json({ products: [], total: 0, limit: f.limit, offset: f.offset })
  }
}

function applyFilters(products: Product[], f: FilterArgs): Product[] {
  return products.filter((p) => {
    // Игры Dessly убраны из общего каталога — покупка только через /send-game.
    if (p.supplier === 'dessly') return false
    if (f.categoryId && p.category_id !== f.categoryId && p.category?.slug !== f.categoryId) return false
    // Группы шапки: в фолбэк-каталоге id категории = slug, сверяем по обоим полям.
    if (f.cats.length > 0 && !f.cats.includes(p.category?.slug || '') && !f.cats.includes(p.category_id || '')) return false
    if (f.types.length > 0 && !f.types.includes(p.type)) return false
    if (f.type && p.type !== f.type) return false
    if (f.supplier && p.supplier !== f.supplier) return false
    if (f.minPrice && p.price < parseFloat(f.minPrice)) return false
    if (f.maxPrice && p.price > parseFloat(f.maxPrice)) return false
    if (f.search && !p.name.toLowerCase().includes(f.search.toLowerCase())) return false
    if (f.region && p.region !== f.region) return false
    return p.is_active
  })
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = parseInt(raw || '', 10)
  if (Number.isNaN(n)) return def
  return Math.min(max, Math.max(min, n))
}

/** "a,b , c" → ['a','b','c'] (пустые элементы отбрасываются) */
function splitCsv(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

