import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { listServices } from '@/lib/approute'
import type { AppRouteService } from '@/lib/approute'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Модульный кеш: AppRoute /services лимитирован (2 req/60s).
// Храним весь каталог 10 минут — повторные поиски не бьют в API.
let catalogCache: AppRouteService[] | null = null
let catalogCachedAt = 0
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 мин

async function getCatalog(): Promise<AppRouteService[]> {
  const now = Date.now()
  if (catalogCache && now - catalogCachedAt < CACHE_TTL_MS) {
    return catalogCache
  }
  const all = await listServices()
  catalogCache = all
  catalogCachedAt = now
  return all
}

/**
 * GET /api/admin/approute-dtu-catalog?search=genshin
 * Возвращает DTU-сервисы из AppRoute каталога. Каталог кешируется 10 мин
 * на уровне модуля, чтобы не упираться в лимит AppRoute (2 req/60s).
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    const search = (request.nextUrl.searchParams.get('search') || '').toLowerCase().trim()

    const all = await getCatalog()

    // Показываем все сервисы — тип 'direct_topup' (боевой API) и 'dtu' (мок/старый API) помечаем.
    // Fallback: если type не задан, ориентируемся на наличие fields (DTU-сервисы требуют полей аккаунта).
    const hasDtuFields = (s: AppRouteService) =>
      s.type === 'direct_topup' || s.type === 'dtu' || (Array.isArray(s.fields) && s.fields.length > 0)

    const results = all
      .filter((s) => !search || s.name.toLowerCase().includes(search))
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type ?? null,
        hasDtuFields: hasDtuFields(s),
        section: s.section || null,
        categoryName: s.categoryName || null,
        subcategoryName: s.subcategoryName || null,
        countryCode: s.countryCode || null,
        denominationsCount: s.items?.length ?? 0,
        fields: s.fields?.map((f) => f.key) ?? [],
      }))
      .sort((a, b) => {
        // Сервисы с DTU-полями — вверх
        if (a.hasDtuFields !== b.hasDtuFields) return a.hasDtuFields ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    const dtuCount = results.filter((s) => s.hasDtuFields).length
    const cachedAgo = Math.round((Date.now() - catalogCachedAt) / 1000)
    return NextResponse.json({
      total: results.length,
      dtu_count: dtuCount,
      services: results,
      cached_ago_seconds: cachedAgo,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
