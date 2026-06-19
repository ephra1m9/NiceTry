import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildCategories, buildCatalogProducts } from '@/lib/catalog'

/**
 * POST /api/products/import
 * Импорт/синхронизация каталога из поставщиков (AppRoute + Dessly) в Supabase.
 * Цены считаются по формуле §5.3 ТЗ внутри buildCatalogProducts().
 * Только для администратора. Запись идёт через service-role клиент (обходит RLS),
 * поэтому строгие RLS-политики на products/categories не мешают импорту.
 *
 * Работает и в мок-режиме (товары-плейсхолдеры), и в боевом (реальные ключи) —
 * без изменения логики: переключение определяется наличием ключей в окружении.
 */
export async function POST() {
  try {
    const supabase = await createClient()

    // Аутентификация + проверка прав администратора (по сессии пользователя).
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: profile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 1) Категории (upsert по slug) → карта slug → uuid.
    const categories = buildCategories()
    const slugToId = new Map<string, string>()
    for (const cat of categories) {
      const { data: existing } = await supabaseAdmin
        .from('categories')
        .select('id')
        .eq('slug', cat.slug)
        .maybeSingle()

      if (existing) {
        slugToId.set(cat.slug, existing.id)
        await supabaseAdmin
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
        const { data: created, error } = await supabaseAdmin
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
        if (error || !created) {
          console.error('[import] category insert failed:', error)
          continue
        }
        slugToId.set(cat.slug, created.id)
      }
    }

    // 2) Товары из поставщиков (цены уже посчитаны по формуле).
    const products = await buildCatalogProducts({ live: true })
    let imported = 0
    let updated = 0
    let sort = 0

    for (const p of products) {
      // p.category_id в построителе = slug → переводим в uuid.
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
        sort_order: sort++,
      }

      // Идентификация существующего товара: для supplier-товаров по (supplier, service, denom),
      // для ручных — по имени.
      let existingId: string | null = null
      if (row.supplier_service_id) {
        const q = supabaseAdmin
          .from('products')
          .select('id')
          .eq('supplier', row.supplier)
          .eq('supplier_service_id', row.supplier_service_id)
        const { data } = row.denomination_id
          ? await q.eq('denomination_id', row.denomination_id).maybeSingle()
          : await q.is('denomination_id', null).maybeSingle()
        existingId = data?.id ?? null
      } else {
        const { data } = await supabaseAdmin
          .from('products')
          .select('id')
          .eq('name', row.name)
          .maybeSingle()
        existingId = data?.id ?? null
      }

      if (existingId) {
        // Сохраняем админ-цену (не перетираем price/ is_active вручную выставленные?).
        // По ТЗ цена «поверх поставщика» управляется в админке, поэтому при ре-импорте
        // обновляем поставщицкие поля и наличие, но НЕ трогаем цену, если она была изменена.
        const { error } = await supabaseAdmin
          .from('products')
          .update({
            name: row.name,
            description: row.description,
            stock: row.stock,
            is_active: row.is_active,
            min_amount: row.min_amount,
            max_amount: row.max_amount,
            supplier_fields: row.supplier_fields,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingId)
        if (!error) updated++
      } else {
        const { error } = await supabaseAdmin.from('products').insert(row)
        if (!error) imported++
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      updated,
      categories: categories.length,
      total: products.length,
    })
  } catch (error) {
    console.error('[import] error:', error)
    return NextResponse.json({ error: 'Failed to import products' }, { status: 500 })
  }
}
