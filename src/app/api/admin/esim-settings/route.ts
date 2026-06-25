import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { DEFAULT_ESIM_SETTINGS } from '@/lib/esim-settings'

// Админка всегда читает/пишет живые настройки — без кэша роута.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Управление настройками страницы /esim из админки (синглтон esim_settings, id=1).
 * Наценка% / курс USD→₽ / вкл-выкл витрины — НЕ хардкод, редактируются здесь.
 * Всё под requireAdmin; запись через service-role (RLS пускает на запись только service-role).
 */

// GET /api/admin/esim-settings — текущие настройки (с фолбэком на дефолты).
export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    const { data } = await guard.admin
      .from('esim_settings')
      .select('markup_percent, usd_to_rub_rate, is_enabled, updated_at')
      .eq('id', 1)
      .maybeSingle()

    return NextResponse.json({ settings: data || { ...DEFAULT_ESIM_SETTINGS } })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

interface PatchBody {
  markup_percent?: number
  usd_to_rub_rate?: number
  is_enabled?: boolean
}

// PATCH /api/admin/esim-settings — обновление настроек (белый список + валидация).
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })

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
    if (body.is_enabled !== undefined) {
      update.is_enabled = Boolean(body.is_enabled)
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }
    update.updated_at = new Date().toISOString()

    // Upsert на синглтон id=1 (строка создаётся миграцией, но подстрахуемся).
    const { data, error } = await guard.admin
      .from('esim_settings')
      .upsert({ id: 1, ...update }, { onConflict: 'id' })
      .select('markup_percent, usd_to_rub_rate, is_enabled, updated_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ settings: data })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
