import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildCatalogProducts, priceRub } from '@/lib/catalog'
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
  const categorySlug = searchParams.get('category_slug')
  const cats = splitCsv(searchParams.get('cats'))
  const types = splitCsv(searchParams.get('types'))
  const type = searchParams.get('type')
  const supplier = searchParams.get('supplier')
  const minPrice = searchParams.get('min_price')
  const maxPrice = searchParams.get('max_price')
  const search = searchParams.get('search')
  // Регион подставляется в PostgREST .or()-фильтр как часть синтаксиса (не как bind-параметр),
  // поэтому ограничиваем алфавитом кодов регионов — иначе спецсимволы могли бы поломать сам фильтр.
  const regionRaw = searchParams.get('region')
  const region = regionRaw && /^[A-Za-z]{2,5}$/.test(regionRaw) ? regionRaw : null
  const limit = clampInt(searchParams.get('limit'), 50, 1, 200)
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100000)

  const filterArgs = { categoryId, categorySlug, cats, types, type, supplier, minPrice, maxPrice, search, region, limit, offset }

  // Supabase-путь с таймаутом: если БД не ответила за 1.5с — сразу фолбэк.
  // Это устраняет задержку 4–8с при недоступном/медленном Supabase.
  try {
    const dbPromise = (async () => {
      const supabase = await createClient()

      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .eq('is_active', true)
        .neq('supplier', 'dessly')

      if (categoryId) query = query.eq('category_id', categoryId)
      if (cats.length > 0) {
        const { data: groupCats } = await supabase
          .from('categories')
          .select('id')
          .in('slug', cats)
        const ids = (groupCats || []).map((c: any) => c.id)
        query = query.in('category_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
      }
      if (types.length > 0) query = query.in('type', types)
      if (type) query = query.eq('type', type)
      if (supplier) query = query.eq('supplier', supplier)
      if (minPrice) query = query.gte('price', parseFloat(minPrice))
      if (maxPrice) query = query.lte('price', parseFloat(maxPrice))
      if (search) query = query.ilike('name', `%${search}%`)
      // Не у всех региональных SKU регион вынесен в суффикс «... (XX)» названия (см. sync-approute.mjs) —
      // часть товаров приходит от поставщика с регионом, зашитым в текст номинала, без суффикса.
      // Поэтому матчим по обоим признакам: колонке region ИЛИ суффиксу в имени.
      // PostgREST требует кавычки вокруг значений со скобками/запятыми внутри or()-фильтра,
      // иначе "(" и ")" из паттерна парсятся как группировка условий, а не как часть значения.
      if (region) query = query.or(`region.eq.${region},name.ilike."%(${region})"`)

      query = query.order('id', { ascending: true }).range(offset, offset + limit - 1)

      const { data: products, error, count } = await query
      if (error || !products) return null
      // Пустой результат без фильтра по region — вероятно, категория ещё не засеяна, тогда
      // осознанно уходим в фолбэк (см. комментарий к fallbackResponse). А пустой результат
      // ПРИ заданном region — легитимный ответ ("нет товаров для этого региона"), и подменять
      // его моком из другого региона/категории нельзя — иначе пользователь увидит чужие товары.
      if (products.length === 0 && !region) return null
      if (products.length === 0) {
        return NextResponse.json({ products: [], total: 0, limit, offset })
      }

      const categoryIds = Array.from(new Set(products.map((p: any) => p.category_id).filter(Boolean)))
      const categoryMap: Record<string, { id: string; name: string; slug: string }> = {}
      if (categoryIds.length > 0) {
        const { data: catRows } = await supabase
          .from('categories')
          .select('id, name, slug')
          .in('id', categoryIds)
        for (const c of catRows || []) categoryMap[c.id] = c
      }
      const withCategories = products.map((p: any) => ({
        ...p,
        category: p.category_id ? categoryMap[p.category_id] || null : null,
      }))
      return NextResponse.json({ products: withCategories, total: count || products.length, limit, offset })
    })()

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
    const result = await Promise.race([dbPromise, timeoutPromise])
    if (result) return result
  } catch (error) {
    console.error('[products] DB error, using catalog fallback:', error)
  }

  return fallbackResponse(filterArgs)
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
  categorySlug: string | null
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

    // Пересчитываем цены по актуальной наценке/курсу из БД (иначе изменения в админке не видны).
    try {
      const supabase = await createClient()
      const { data: cats } = await supabase.from('categories').select('slug, usd_to_rub_rate, markup_percent')
      if (cats && cats.length > 0) {
        const catMap = new Map<string, { rate: number; markup: number }>(
          cats.map((c: any) => [c.slug, { rate: Number(c.usd_to_rub_rate), markup: Number(c.markup_percent ?? 0) }])
        )
        products = products.map((p) => {
          const slug = p.category?.slug
          const priceUsd = (p as any).price_usd as number | undefined
          if (!slug || !priceUsd || priceUsd <= 0) return p
          const cat = catMap.get(slug)
          if (!cat || cat.rate <= 0) return p
          return { ...p, price: priceRub(priceUsd, cat.rate, cat.markup) }
        })
      }
    } catch { /* оставляем статические цены если БД недоступна */ }

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
    // categorySlug всегда slug ('psn'), categoryId может быть UUID из Supabase.
    // Используем slug как приоритетный ключ для fallback-фильтра.
    const catKey = f.categorySlug ?? f.categoryId
    if (catKey && p.category_id !== catKey && p.category?.slug !== catKey) return false
    // Группы шапки: в фолбэк-каталоге id категории = slug, сверяем по обоим полям.
    if (f.cats.length > 0 && !f.cats.includes(p.category?.slug || '') && !f.cats.includes(p.category_id || '')) return false
    if (f.types.length > 0 && !f.types.includes(p.type)) return false
    if (f.type && p.type !== f.type) return false
    if (f.supplier && p.supplier !== f.supplier) return false
    if (f.minPrice && p.price < parseFloat(f.minPrice)) return false
    if (f.maxPrice && p.price > parseFloat(f.maxPrice)) return false
    if (f.search && !p.name.toLowerCase().includes(f.search.toLowerCase())) return false
    if (f.region && p.region !== f.region && !p.name.includes(`(${f.region})`)) return false
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

