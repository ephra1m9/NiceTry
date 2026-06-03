import { NextRequest, NextResponse } from 'next/server'
import { listGames, isLiveMode } from '@/lib/dessly'
import type { DesslyGame } from '@/lib/dessly'

/**
 * GET /api/dessly/games
 * Живой список игр Dessly (из боевого API или мок-каталога) с поиском и пагинацией.
 *
 * Query params:
 *   search  — фильтр по названию (ilike, минимум 2 символа)
 *   limit   — размер страницы (по умолчанию 50, максимум 200)
 *   offset  — смещение (по умолчанию 0)
 *
 * Возвращает:
 *   { games: [{ app_id, name, image_url }], total, limit, offset, live: boolean }
 *
 * image_url — Steam header (https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{app_id}/header.jpg)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const search = (searchParams.get('search') || '').trim().toLowerCase()
    const limit = clamp(searchParams.get('limit'), 50, 1, 200)
    const offset = clamp(searchParams.get('offset'), 0, 0, 50000)

    const games = await listGames()

    // Фильтр по поиску (если есть)
    let filtered = games
    if (search.length >= 2) {
      filtered = games.filter((g) => g.name.toLowerCase().includes(search))
    } else if (search.length === 1) {
      // Одна буква — ищем по началу названия
      filtered = games.filter((g) => g.name.toLowerCase().startsWith(search))
    }

    // Пагинация
    const total = filtered.length
    const page = filtered.slice(offset, offset + limit)

    // Добавляем URL картинки Steam
    const result = page.map((g) => ({
      app_id: g.appid || Number(g.id) || 0,
      name: g.name,
      image_url: g.appid
        ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg`
        : null,
      // Плейсхолдер если нет картинки
      image_fallback: !g.appid,
    }))

    return NextResponse.json({
      games: result,
      total,
      limit,
      offset,
      live: isLiveMode(),
    })
  } catch (error: any) {
    console.error('[dessly/games] error:', error)
    return NextResponse.json({ error: 'Failed to fetch games' }, { status: 500 })
  }
}

function clamp(raw: string | null, def: number, min: number, max: number): number {
  const n = parseInt(raw || '', 10)
  if (Number.isNaN(n)) return def
  return Math.min(max, Math.max(min, n))
}
