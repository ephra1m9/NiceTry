import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { calcPriceRub } from '@/lib/game-topup-settings'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET  /api/admin/game-topup-settings — список всех игр (включая неактивные) с настройками.
 * POST /api/admin/game-topup-settings — создание новой игры.
 * PATCH /api/admin/game-topup-settings — обновление настроек игры по id.
 */

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    const { data } = await guard.admin
      .from('game_topup_games')
      .select('*')
      .order('sort_order', { ascending: true })

    return NextResponse.json({ games: data ?? [] })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Пустое тело запроса' }, { status: 400 })

    const name = (body.name as string | undefined)?.trim()
    const slug = (body.slug as string | undefined)?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!name) return NextResponse.json({ error: 'Поле name обязательно' }, { status: 400 })
    if (!slug)  return NextResponse.json({ error: 'Поле slug обязательно' }, { status: 400 })

    const markup = Number(body.markup_percent ?? 20)
    const rate   = Number(body.usd_to_rub_rate ?? 85)
    if (!Number.isFinite(markup) || markup < 0) return NextResponse.json({ error: 'Наценка должна быть ≥ 0' }, { status: 400 })
    if (!Number.isFinite(rate)   || rate <= 0)  return NextResponse.json({ error: 'Курс должен быть > 0' }, { status: 400 })

    let account_fields: unknown[] = []
    if (body.account_fields) {
      try {
        account_fields = typeof body.account_fields === 'string'
          ? JSON.parse(body.account_fields)
          : (body.account_fields as unknown[])
      } catch {
        return NextResponse.json({ error: 'account_fields: невалидный JSON' }, { status: 400 })
      }
    }

    const maxOrder = await guard.admin
      .from('game_topup_games')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()
    const sort_order = (maxOrder.data?.sort_order ?? 0) + 1

    const { data: game, error: insertErr } = await guard.admin
      .from('game_topup_games')
      .insert({
        name,
        slug,
        markup_percent: markup,
        usd_to_rub_rate: rate,
        image_url: (body.image_url as string | undefined) || null,
        approute_service_id: (body.approute_service_id as string | undefined) || null,
        approute_service_ids: body.approute_service_ids || null,
        account_fields,
        is_active: body.is_active !== false,
        sort_order,
      })
      .select()
      .single()

    if (insertErr) {
      const msg = insertErr.code === '23505'
        ? `Slug «${slug}» уже занят — выберите другой`
        : insertErr.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    return NextResponse.json({ game }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

interface PatchBody {
  id: string
  markup_percent?: number
  usd_to_rub_rate?: number
  image_url?: string | null
  is_active?: boolean
  approute_service_id?: string | null
  approute_service_ids?: Record<string, string> | null
  account_fields?: unknown[]
  sort_order?: number
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body || !body.id) return NextResponse.json({ error: 'Не указан id игры' }, { status: 400 })

    const update: Record<string, unknown> = {}

    if (body.markup_percent !== undefined) {
      const v = Number(body.markup_percent)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'Наценка должна быть ≥ 0' }, { status: 400 })
      update.markup_percent = v
    }
    if (body.usd_to_rub_rate !== undefined) {
      const v = Number(body.usd_to_rub_rate)
      if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: 'Курс должен быть > 0' }, { status: 400 })
      update.usd_to_rub_rate = v
    }
    if (body.image_url !== undefined) update.image_url = body.image_url || null
    if (body.is_active !== undefined) update.is_active = Boolean(body.is_active)
    if (body.approute_service_id !== undefined) update.approute_service_id = body.approute_service_id || null
    if (body.approute_service_ids !== undefined) update.approute_service_ids = body.approute_service_ids || null
    if (body.account_fields !== undefined) update.account_fields = body.account_fields
    if (body.sort_order !== undefined) update.sort_order = Number(body.sort_order)

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }
    update.updated_at = new Date().toISOString()

    const { data: game, error: updateErr } = await guard.admin
      .from('game_topup_games')
      .update(update)
      .eq('id', body.id)
      .select()
      .single()
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Пересчитываем price_rub для деноминаций игры, если изменилась наценка или курс.
    if (body.markup_percent !== undefined || body.usd_to_rub_rate !== undefined) {
      const { data: denoms } = await guard.admin
        .from('game_topup_denominations')
        .select('id, price_usd')
        .eq('game_id', body.id)
      if (denoms && denoms.length > 0) {
        const markup = Number(game.markup_percent)
        const rate = Number(game.usd_to_rub_rate)
        const updates = denoms.map((d) => ({
          id: d.id,
          price_rub: calcPriceRub(Number(d.price_usd), rate, markup),
        }))
        for (const upd of updates) {
          await guard.admin
            .from('game_topup_denominations')
            .update({ price_rub: upd.price_rub })
            .eq('id', upd.id)
        }
      }
    }

    return NextResponse.json({ game })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
