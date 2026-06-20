import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { fetchTelegramPackages, STARS_SERVICE_ID, PREMIUM_SERVICE_ID } from '@/lib/telegram-sync'

/**
 * POST /api/admin/sync-telegram
 * Синхронизация пакетов Telegram Stars/Premium из AppRoute в telegram_packages
 * (кнопка «Синхронизировать» на /admin/telegram-orders). Аналог /api/admin/sync-approute,
 * но только для двух сервисов Stars/Premium — модалка покупки и /api/telegram/buy
 * после этого читают только БД, к AppRoute не обращаются.
 *
 * Полная замена набора (delete + insert): таблица целиком управляется синком, поэтому
 * пакеты, которые поставщик убрал из ассортимента, корректно исчезают.
 */
export async function POST() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const rows = await fetchTelegramPackages()
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'AppRoute не вернул пакеты Stars/Premium — проверьте service id в lib/telegram-sync.ts' },
        { status: 502 }
      )
    }

    await supabase.from('telegram_packages').delete().in('service_id', [STARS_SERVICE_ID, PREMIUM_SERVICE_ID])

    const { error } = await supabase
      .from('telegram_packages')
      .insert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })))
    if (error) {
      console.error('[sync-telegram] insert failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      stars: rows.filter((r) => r.product_type === 'stars').length,
      premium: rows.filter((r) => r.product_type === 'premium').length,
    })
  } catch (error: any) {
    console.error('[sync-telegram] error:', error)
    return NextResponse.json({ error: 'Не удалось синхронизировать пакеты Telegram' }, { status: 500 })
  }
}
