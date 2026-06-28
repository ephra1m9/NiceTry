import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const { count } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', params.id)

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Нельзя удалить: в категории есть ${count} товар(ов). Сначала удалите или перенесите товары.` },
        { status: 409 }
      )
    }

    const { error } = await supabase.from('categories').delete().eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}

const ALLOWED_FIELDS = ['name', 'slug', 'icon', 'markup_percent', 'usd_to_rub_rate', 'is_active', 'sort_order', 'supplier'] as const
const NUMERIC_FIELDS = new Set(['markup_percent', 'usd_to_rub_rate', 'sort_order'])
const PRICE_FIELDS = new Set(['markup_percent', 'usd_to_rub_rate'])

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (!(key in body)) continue
      let value = (body as Record<string, unknown>)[key]
      if (NUMERIC_FIELDS.has(key)) {
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: `Поле ${key} должно быть числом ≥ 0` }, { status: 400 })
        }
        value = n
      }
      if (key === 'is_active') value = Boolean(value)
      update[key] = value
    }

    if ('regions' in body) {
      update.regions = Array.isArray(body.regions) ? body.regions : []
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const priceFieldChanged = ALLOWED_FIELDS.some((k) => PRICE_FIELDS.has(k) && k in update)

    // Читаем старые значения ДО обновления — нужны для обратного пересчёта цен.
    let oldRate = 0
    let oldMarkup = 0
    if (priceFieldChanged) {
      const { data: current } = await supabase
        .from('categories')
        .select('usd_to_rub_rate, markup_percent')
        .eq('id', params.id)
        .single()
      oldRate = Number(current?.usd_to_rub_rate ?? 0)
      oldMarkup = Number(current?.markup_percent ?? 0)
    }

    update.updated_at = new Date().toISOString()

    const { data: category, error } = await supabase
      .from('categories')
      .update(update)
      .eq('id', params.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Пересчёт цен товаров при смене наценки/курса.
    // Стратегия: price_usd ≈ price_rub_old / (old_rate × (100 + old_markup) / 100).
    // Погрешность из-за ceil ≤ 1 ₽ на конечную цену — приемлемо для перерасчёта.
    // Не зависит от колонки price_usd в БД.
    if (priceFieldChanged && category && oldRate > 0) {
      const newRate = Number(category.usd_to_rub_rate)
      const newMarkup = Number(category.markup_percent)
      if (newRate > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, price')
          .eq('category_id', params.id)
          .gt('price', 0)

        if (products && products.length > 0) {
          const oldDivisor = oldRate * (100 + oldMarkup) / 100
          const newFactor = newRate * (100 + newMarkup) / 100
          const now = new Date().toISOString()
          for (const p of products) {
            const priceUsd = Number(p.price) / oldDivisor
            const newPrice = Math.ceil(priceUsd * newFactor)
            await supabase
              .from('products')
              .update({ price: newPrice, updated_at: now })
              .eq('id', p.id)
          }
        }
      }
    }

    return NextResponse.json({ category })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
