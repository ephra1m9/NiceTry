import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { listServices } from '@/lib/approute'
import { calcPriceRub } from '@/lib/game-topup-settings'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/sync-game-topups — синхронизация деноминаций из AppRoute.
 *
 * Для каждой игры с заданным approute_service_id (или approute_service_ids для мультирегиональных)
 * находит сервис в каталоге AppRoute и делает upsert деноминаций в game_topup_denominations.
 * Цена пересчитывается с текущими markup_percent / usd_to_rub_rate игры.
 *
 * Игры без approute_service_id пропускаются (admin должен заполнить ID вручную после
 * выяснения через AppRoute каталог).
 */
export async function POST() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    // Загружаем все игры (включая неактивные — может потребоваться синк перед активацией).
    const { data: games, error: gamesErr } = await guard.admin
      .from('game_topup_games')
      .select('*')
      .order('sort_order', { ascending: true })
    if (gamesErr || !games) {
      return NextResponse.json({ error: 'Не удалось загрузить список игр' }, { status: 500 })
    }

    // Загружаем каталог AppRoute один раз (минимизируем кол-во запросов к API).
    let catalog: Awaited<ReturnType<typeof listServices>> = []
    try {
      catalog = await listServices()
    } catch (e: any) {
      return NextResponse.json({
        error: `AppRoute недоступен: ${e?.message || e}`,
        note: 'Убедитесь, что APPROUTE_API_KEY и APPROUTE_BASE_URL заданы правильно',
      }, { status: 502 })
    }

    const results: Array<{ slug: string; synced: number; skipped: string }> = []

    for (const game of games) {
      const markup = Number(game.markup_percent ?? 20)
      const rate = Number(game.usd_to_rub_rate ?? 85)

      // Мультирегиональная игра (напр. PUBG Mobile CIS + Global).
      if (game.approute_service_ids && typeof game.approute_service_ids === 'object') {
        const serviceMap = game.approute_service_ids as Record<string, string>
        let totalSynced = 0

        for (const [region, serviceId] of Object.entries(serviceMap)) {
          const service = catalog.find((s) => s.id === serviceId)
          if (!service) {
            results.push({ slug: game.slug, synced: 0, skipped: `service ${serviceId} (${region}) not found` })
            continue
          }
          const synced = await upsertDenominations(game.id, service.items, markup, rate, region)
          totalSynced += synced
        }
        results.push({ slug: game.slug, synced: totalSynced, skipped: '' })
        continue
      }

      // Одиночный сервис.
      if (!game.approute_service_id) {
        results.push({ slug: game.slug, synced: 0, skipped: 'approute_service_id не задан' })
        continue
      }
      const service = catalog.find((s) => s.id === game.approute_service_id)
      if (!service) {
        results.push({ slug: game.slug, synced: 0, skipped: `service ${game.approute_service_id} не найден в каталоге` })
        continue
      }
      const synced = await upsertDenominations(game.id, service.items, markup, rate, null)
      results.push({ slug: game.slug, synced, skipped: '' })
    }

    const totalSynced = results.reduce((s, r) => s + r.synced, 0)
    return NextResponse.json({
      success: true,
      total_synced: totalSynced,
      results,
    })
  } catch (error: any) {
    console.error('[sync-game-topups] unexpected error:', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

async function upsertDenominations(
  gameId: string,
  items: Array<{ id: string; name: string; price: number; inStock: number | boolean }>,
  markup: number,
  rate: number,
  region: string | null
): Promise<number> {
  if (!items || items.length === 0) return 0
  let synced = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const priceRub = calcPriceRub(item.price, rate, markup)
    const { error } = await supabaseAdmin
      .from('game_topup_denominations')
      .upsert(
        {
          game_id: gameId,
          approute_denomination_id: item.id,
          name: item.name,
          price_usd: item.price,
          price_rub: priceRub,
          region: region,
          sort_order: i,
          is_active: item.inStock === true || (typeof item.inStock === 'number' && item.inStock > 0),
        },
        { onConflict: 'game_id,approute_denomination_id,region' }
      )
    if (!error) synced++
    else console.warn('[sync-game-topups] upsert error:', error.message, { gameId, itemId: item.id })
  }
  return synced
}
