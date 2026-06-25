import { NextRequest, NextResponse } from 'next/server'
import { getEsimVariant, esimPackageBucket, type DesslyEsimPlan } from '@/lib/dessly'
import { loadEsimSettings } from '@/lib/esim-settings'
import { priceRub } from '@/lib/catalog'

/**
 * GET /api/dessly/esim/variants/[id]
 * Тарифы внутри пакета (ГБ/минуты/смс + цена в ₽ по курсу/наценке esim_settings).
 *
 * Реальные ключи атрибутов тарифа у Dessly (подтверждено живым дампом, см. WORKLOG):
 *   esim_data_quantity + esim_data_unit ("GB"|"MB"), esim_validity_days, esim_voice_minutes,
 *   esim_sms_quantity — все строками. Дополнительно держим устаревший список синонимов (для
 *   мок-каталога catalog.json) и текстовый фолбэк парсингом name/description на случай, если
 *   у continent/global пакетов набор полей отличается от country-пакетов.
 */

const GB_KEYS = ['dataGb', 'data_gb', 'data_amount', 'dataAmount', 'data_volume', 'dataVolume', 'volume', 'gb', 'data']
const VALIDITY_KEYS = ['esim_validity_days', 'validityDays', 'validity_days', 'validity', 'days', 'period', 'duration_days', 'durationDays']
const VOICE_KEYS = ['esim_voice_minutes', 'voiceMinutes', 'voice_minutes', 'minutes', 'voice']
const SMS_KEYS = ['esim_sms_quantity', 'smsCount', 'sms_count', 'sms']

function firstNumericAttr(attrs: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!attrs) return null
  for (const k of keys) {
    const v = attrs[k]
    if (v == null) continue
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function fromText(text: string, re: RegExp): number | null {
  const m = text.match(re)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function planUnlimited(p: DesslyEsimPlan): boolean {
  const attrs = p.attributes || {}
  if (attrs.esim_unlimited === true || String(attrs.esim_unlimited).toLowerCase() === 'true') return true
  return /unlimited/i.test(`${p.name} ${p.description}`)
}

function planDataGb(p: DesslyEsimPlan): number | null {
  const attrs = p.attributes || {}
  // Реальный Dessly: количество и единица измерения раздельно (esim_data_quantity/esim_data_unit) —
  // нужно свести MB к ГБ, иначе для мелких пакетов («50MB») получим неверное число.
  const qty = Number(attrs.esim_data_quantity)
  if (Number.isFinite(qty) && qty > 0) {
    const unit = String(attrs.esim_data_unit || 'GB').toUpperCase()
    return unit === 'MB' ? qty / 1024 : qty
  }
  return (
    firstNumericAttr(attrs, GB_KEYS) ??
    fromText(`${p.name} ${p.description}`, /(\d+(?:\.\d+)?)\s*(?:GB|Гб|ГБ)/i)
  )
}
function planValidityDays(p: DesslyEsimPlan): number | null {
  return (
    firstNumericAttr(p.attributes, VALIDITY_KEYS) ??
    fromText(`${p.name} ${p.description}`, /(\d+)\s*(?:Days?|дн(?:ей|я)?)/i)
  )
}
function planVoiceMinutes(p: DesslyEsimPlan): number | null {
  return (
    firstNumericAttr(p.attributes, VOICE_KEYS) ??
    fromText(`${p.name} ${p.description}`, /(\d+)\s*(?:min(?:ute)?s?|мин(?:ут)?)/i)
  )
}
function planSmsCount(p: DesslyEsimPlan): number | null {
  return (
    firstNumericAttr(p.attributes, SMS_KEYS) ??
    fromText(`${p.name} ${p.description}`, /(\d+)\s*(?:sms|смс)/i)
  )
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const detail = await getEsimVariant(id)
    if (!detail) {
      return NextResponse.json({ error: 'Пакет eSIM не найден' }, { status: 404 })
    }
    const { usd_to_rub_rate: rate, markup_percent: markup } = await loadEsimSettings()

    return NextResponse.json({
      variant: {
        id: detail.variant.id,
        name: detail.variant.name,
        description: detail.variant.description,
        image: detail.variant.image || null,
        country: detail.variant.country || null,
        continent: detail.variant.continent || null,
        esim_countries: detail.variant.esimCountries || null,
        package_type: esimPackageBucket(detail.variant.packageType),
      },
      plans: detail.plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price_usd: p.price,
        price_rub: priceRub(p.price, rate, markup),
        stock: p.stock,
        max_per_order: p.maxPerOrder,
        data_gb: planDataGb(p),
        unlimited: planUnlimited(p),
        validity_days: planValidityDays(p),
        voice_minutes: planVoiceMinutes(p),
        sms_count: planSmsCount(p),
      })),
    })
  } catch (error) {
    console.error('[dessly/esim/variants/id] error:', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Не удалось загрузить тарифы пакета: ${detail}` }, { status: 500 })
  }
}
