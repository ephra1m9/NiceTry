import { NextResponse } from 'next/server'
import { loadTelegramCatalog, loadTelegramSettings, telegramPriceRub, type TelegramPackage } from '@/lib/telegram-pricing'

// Публичный конфиг для модалки покупки: пакеты Stars/Premium из telegram_packages
// (синхронизированы из AppRoute кнопкой в админке, см. /api/admin/sync-telegram) с уже
// посчитанной ценой в ₽ (наценка% + курс из telegram_settings). Цена пересчитывается на
// сервере заново при покупке в /api/telegram/buy — этот эндпоинт только для отображения.
export const dynamic = 'force-dynamic'
export const revalidate = 0

function withPrice(pkgs: TelegramPackage[], markupPercent: number, usdToRubRate: number) {
  return pkgs.map((p) => ({
    id: p.id,
    amount: p.amount,
    label: p.label,
    price: telegramPriceRub(p.price_usd, markupPercent, usdToRubRate),
  }))
}

export async function GET() {
  try {
    const [catalog, settings] = await Promise.all([loadTelegramCatalog(), loadTelegramSettings()])
    return NextResponse.json({
      stars: withPrice(catalog.stars, settings.markup_percent, settings.usd_to_rub_rate),
      premium: withPrice(catalog.premium, settings.markup_percent, settings.usd_to_rub_rate),
    })
  } catch (error) {
    console.error('[telegram/config] failed to load catalog:', error)
    return NextResponse.json({ stars: [], premium: [] })
  }
}
