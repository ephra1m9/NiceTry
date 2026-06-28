import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildCategories } from '@/lib/catalog'

/**
 * GET /api/categories
 * Активные категории. Фолбэк на каталог из catalog.json, если БД пуста/недоступна.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      // Категория игр Dessly убрана из каталога — отправка игр только через /send-game.
      .neq('slug', 'dessly-games')
      // auto-games идёт отдельным полем, чтобы клиент мог отличить «не в БД» от «деактивирована».
      .neq('slug', 'auto-games')
      .order('sort_order', { ascending: true })

    if (!error && categories && categories.length > 0) {
      // Отдельно загружаем auto-games (независимо от is_active) для главной страницы.
      const { data: autoGamesRows } = await supabase
        .from('categories')
        .select('*')
        .eq('slug', 'auto-games')
        .single()
      return NextResponse.json({ categories, autoGamesCategory: autoGamesRows ?? null })
    }
    return NextResponse.json({ categories: catalogFallbackCategories(), source: 'catalog-fallback' })
  } catch (error) {
    console.error('[categories] DB unavailable, using fallback:', error)
    return NextResponse.json({ categories: catalogFallbackCategories(), source: 'catalog-fallback' })
  }
}

/** Категории из catalog.json без dessly-games (та доступна только на /send-game). */
function catalogFallbackCategories() {
  return buildCategories().filter((c) => c.slug !== 'dessly-games')
}
