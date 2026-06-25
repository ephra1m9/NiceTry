import { NextRequest, NextResponse } from 'next/server'
import { listEsimVariants, esimPackageBucket, isLiveMode, type DesslyEsimVariant } from '@/lib/dessly'

function isGlobalEntry(v: VariantEntry): boolean {
  if (v.country || v.continent) return false
  return /global/i.test(v.name)
}

interface VariantEntry {
  id: string
  name: string
  description: string
  image: string | null
  country: string | null
  continent: string | null
  esim_countries: string[] | null
  package_type: 'data' | 'data_voice_sms'
}

// Каталог Dessly пагинирован (на боевом ключе — ~200 пакетов на страницу, всего ~400+:
// почти на каждую страну есть и DATA-ONLY, и DATA-VOICE-SMS variant, плюс несколько
// continent/global). Витрине нужен полный список (страна выбирается из общего списка), поэтому
// собираем все страницы здесь и кэшируем на 5 минут — каталог стран меняется не часто,
// а дёргать Dessly на каждое открытие вкладки/каждого пользователя смысла нет.
const ALL_VARIANTS_TTL_MS = 5 * 60_000
const MAX_PAGES = 20 // защита от бесконечного cursor-цикла при сбое на стороне Dessly
let _cache: { ts: number; variants: DesslyEsimVariant[] } | null = null
let _pending: Promise<DesslyEsimVariant[]> | null = null

async function loadAllVariants(): Promise<DesslyEsimVariant[]> {
  if (_cache && Date.now() - _cache.ts < ALL_VARIANTS_TTL_MS) return _cache.variants
  if (_pending) return _pending
  _pending = (async () => {
    const all: DesslyEsimVariant[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const { variants, nextCursor } = await listEsimVariants(cursor)
      all.push(...variants)
      if (!nextCursor || variants.length === 0) break
      cursor = nextCursor
    }
    _cache = { ts: Date.now(), variants: all }
    return all
  })()
  try {
    return await _pending
  } finally {
    _pending = null
  }
}

/**
 * GET /api/dessly/esim/variants
 * Полный список пакетов eSIM (без тарифов внутри — см. /variants/[id]), все страницы Dessly
 * собраны в один список. Фильтрация по типу пакета (вкладка витрины) и поиск по стране/названию.
 *
 * Query params:
 *   type    — 'data' (Только интернет) | 'data_voice_sms' (Интернет, звонки, смс)
 *   search  — фильтр по названию/стране
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const type = sp.get('type')
    const search = (sp.get('search') || '').trim().toLowerCase()

    const variants = await loadAllVariants()

    let entries: VariantEntry[] = variants.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      image: v.image || null,
      country: v.country || null,
      continent: v.continent || null,
      esim_countries: v.esimCountries || null,
      package_type: esimPackageBucket(v.packageType),
    }))

    if (type === 'data' || type === 'data_voice_sms') {
      entries = entries.filter((v) => v.package_type === type)
    }
    if (search.length >= 2) {
      entries = entries.filter(
        (v) =>
          v.name.toLowerCase().includes(search) ||
          (v.country || '').toLowerCase().includes(search) ||
          (v.continent || '').toLowerCase().includes(search)
      )
    }

    // Global-пакет (geo_scope=global, без привязки к стране/континенту) — на первое место в списке.
    entries.sort((a, b) => Number(isGlobalEntry(b)) - Number(isGlobalEntry(a)))

    return NextResponse.json({
      variants: entries,
      live: isLiveMode(),
    })
  } catch (error) {
    console.error('[dessly/esim/variants] error:', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Не удалось загрузить пакеты eSIM: ${detail}` }, { status: 500 })
  }
}
