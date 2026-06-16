import { NextRequest, NextResponse } from 'next/server'
import { getGame, isLiveMode } from '@/lib/dessly'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildCategories, priceRub } from '@/lib/catalog'

/**
 * GET /api/dessly/games/[id]?region=RU
 * Издания конкретной игры с ценой под выбранный регион.
 *
 * Dessly отдаёт издание с массивом regions_info[] (цена зависит от региона).
 * Для UI отправки игры мы «уплощаем» каждое издание до одной цены под `region`
 * (если регион не передан/не найден — берём первый доступный регион издания).
 *
 * Ответ: { editions: [{ edition, packageId, price, priceOriginal, discount, region, price_rub, price_rub_original }], live }
 * price_rub — серверный расчёт по актуальному курсу/наценке категории dessly-games,
 * идентичный тому, что списывается при создании заказа (orders/create).
 */

async function loadDesslyRateMarkup(): Promise<{ rate: number; markup: number }> {
  try {
    const { data: cat } = await supabaseAdmin
      .from('categories')
      .select('usd_to_rub_rate, markup_percent')
      .eq('slug', 'dessly-games')
      .maybeSingle()
    if (cat && Number(cat.usd_to_rub_rate) > 0) {
      return { rate: Number(cat.usd_to_rub_rate), markup: Number(cat.markup_percent || 0) }
    }
  } catch {
    // fallback below
  }
  const fallback = buildCategories().find((c) => c.slug === 'dessly-games')
  return { rate: fallback?.usd_to_rub_rate ?? 82, markup: fallback?.markup_percent ?? 18 }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const appId = params.id
    const wantRegion = (request.nextUrl.searchParams.get('region') || '').trim().toUpperCase()

    const [editions, { rate, markup }] = await Promise.all([
      getGame(appId),
      loadDesslyRateMarkup(),
    ])

    const flat = editions
      .map((e) => {
        const rp =
          (wantRegion && e.regions.find((r) => r.region === wantRegion)) || e.regions[0]
        if (!rp) return null
        const priceOrig = rp.priceOriginal || rp.price
        return {
          edition: e.edition || 'Standard',
          packageId: e.packageId,
          price: rp.price,
          priceOriginal: priceOrig,
          discount: rp.discount,
          region: rp.region,
          price_rub: priceRub(rp.price, rate, markup),
          price_rub_original: priceRub(priceOrig, rate, markup),
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null && !!e.packageId)

    return NextResponse.json({ editions: flat, live: isLiveMode() })
  } catch (error: any) {
    console.error('[dessly/games/:id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch game editions' }, { status: 500 })
  }
}
