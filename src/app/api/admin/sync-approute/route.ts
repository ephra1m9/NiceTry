import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { buildCategories, buildCatalogProducts } from '@/lib/catalog'

/**
 * POST /api/admin/sync-approute
 * Синхронизация каталога AppRoute в Supabase из админки (кнопка «Синхронизировать каталог AppRoute»).
 * Аналог CLI `npm run sync:approute`, но в контексте запроса под requireAdmin().
 *
 * Только AppRoute-категории и товары (supplier='approute') — отправка игр Dessly синхронизируется
 * отдельно (Блок B4). Цены считаются по формуле §5.3 внутри buildCatalogProducts(). Идемпотентно:
 * апсерт по (supplier, supplier_service_id, denomination_id) — повторный запуск не плодит дубли.
 * В мок-режиме (нет боевого APPROUTE_BASE_URL) берётся фолбэк-каталог — витрина остаётся наполненной.
 */
export async function POST() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response
    const supabase = guard.admin

    // 1) Категории AppRoute → upsert по slug, карта slug→uuid.
    const categories = buildCategories().filter((c) => c.supplier === 'approute')
    const slugToId = new Map<string, string>()
    for (const cat of categories) {
      const { data: existing } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', cat.slug)
        .maybeSingle()
      if (existing) {
        slugToId.set(cat.slug, existing.id)
        await supabase
          .from('categories')
          .update({
            name: cat.name,
            icon: cat.icon,
            markup_percent: cat.markup_percent,
            usd_to_rub_rate: cat.usd_to_rub_rate,
            supplier: cat.supplier,
            sort_order: cat.sort_order,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        const { data: created } = await supabase
          .from('categories')
          .insert({
            name: cat.name,
            slug: cat.slug,
            icon: cat.icon,
            markup_percent: cat.markup_percent,
            usd_to_rub_rate: cat.usd_to_rub_rate,
            supplier: cat.supplier,
            is_active: true,
            sort_order: cat.sort_order,
          })
          .select('id')
          .single()
        if (created) slugToId.set(cat.slug, created.id)
      }
    }

    // 2) Товары AppRoute (цены уже посчитаны) → идемпотентный апсерт.
    const products = (await buildCatalogProducts()).filter((p) => p.supplier === 'approute')
    let imported = 0
    let updated = 0
    let failed = 0
    let sort = 0
    for (const p of products) {
      const categoryId = slugToId.get(p.category_id) || slugToId.get(p.category?.slug || '')
      if (!categoryId) continue

      const row = {
        name: p.name,
        description: p.description,
        type: p.type,
        category_id: categoryId,
        price: p.price,
        stock: p.stock ?? null,
        is_active: p.is_active,
        supplier: p.supplier,
        supplier_service_id: p.supplier_id ?? null,
        denomination_id: p.denomination_id ?? null,
        min_amount: p.min_amount ?? null,
        max_amount: p.max_amount ?? null,
        supplier_fields: p.supplier_fields ?? null,
        image_url: p.image_url ?? null,
        sort_order: sort++,
      }

      let existingId: string | null = null
      if (row.supplier_service_id) {
        const q = supabase
          .from('products')
          .select('id')
          .eq('supplier', row.supplier)
          .eq('supplier_service_id', row.supplier_service_id)
        const { data } = row.denomination_id
          ? await q.eq('denomination_id', row.denomination_id).maybeSingle()
          : await q.is('denomination_id', null).maybeSingle()
        existingId = data?.id ?? null
      }

      if (existingId) {
        // Цена «поверх поставщика» управляется в админке — при ре-импорте не перетираем price,
        // обновляем только поставщицкие поля и наличие (как в /api/products/import).
        const { error } = await supabase
          .from('products')
          .update({
            name: row.name,
            description: row.description,
            stock: row.stock,
            is_active: row.is_active,
            min_amount: row.min_amount,
            max_amount: row.max_amount,
            supplier_fields: row.supplier_fields,
            image_url: row.image_url,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingId)
        // Не глотаем ошибку записи: иначе синк отрапортует success при реальном провале.
        if (error) {
          failed++
          console.error('[sync-approute] update failed', existingId, error.message)
        } else {
          updated++
        }
      } else {
        const { error } = await supabase.from('products').insert(row)
        if (error) {
          failed++
          console.error('[sync-approute] insert failed', row.name, error.message)
        } else {
          imported++
        }
      }
    }

    return NextResponse.json({
      success: failed === 0,
      supplier: 'approute',
      categories: categories.length,
      imported,
      updated,
      failed,
      total: products.length,
    })
  } catch (error: any) {
    console.error('[sync-approute] error:', error)
    return NextResponse.json({ error: 'Не удалось синхронизировать каталог AppRoute' }, { status: 500 })
  }
}
