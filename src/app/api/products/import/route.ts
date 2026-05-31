import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServices } from '@/lib/approute'

/**
 * POST /api/products/import
 * Импорт товаров из AppRoute в БД
 * Требует авторизации администратора
 */
export async function POST() {
  try {
    const supabase = await createClient()

    // Проверка авторизации и прав администратора
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userProfile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Получаем сервисы из AppRoute
    const services = await getServices()

    // Создаём или обновляем категории
    const categoryMap = new Map<string, string>()

    const uniqueCategories = [
      ...new Set(services.map((s) => s.category)),
    ]

    for (const categoryName of uniqueCategories) {
      const slug = categoryName.toLowerCase().replace(/\s+/g, '-')

      const { data: existingCategory } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', slug)
        .single()

      if (existingCategory) {
        categoryMap.set(categoryName, existingCategory.id)
      } else {
        const { data: newCategory, error } = await supabase
          .from('categories')
          .insert({
            name: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
            slug,
            supplier: 'approute',
            is_active: true,
          })
          .select('id')
          .single()

        if (error) {
          console.error('Error creating category:', error)
          continue
        }

        if (newCategory) {
          categoryMap.set(categoryName, newCategory.id)
        }
      }
    }

    // Импортируем товары
    let importedCount = 0
    let updatedCount = 0

    for (const service of services) {
      const categoryId = categoryMap.get(service.category)
      if (!categoryId) continue

      // Для товаров с деноминациями создаём отдельный товар для каждой деноминации
      if (service.denominations && service.denominations.length > 0) {
        for (const denom of service.denominations) {
          const productName = `${service.name} - ${denom.name}`
          const priceRub = Math.ceil(denom.price_usd * 80 * 1.14) // USD -> RUB с наценкой 14%

          // Проверяем существование товара
          const { data: existingProduct } = await supabase
            .from('products')
            .select('id')
            .eq('supplier', 'approute')
            .eq('supplier_service_id', service.id)
            .eq('denomination_id', denom.id)
            .single()

          if (existingProduct) {
            // Обновляем существующий товар
            const { error } = await supabase
              .from('products')
              .update({
                name: productName,
                price: priceRub,
                stock: denom.stock,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingProduct.id)

            if (!error) updatedCount++
          } else {
            // Создаём новый товар
            const { error } = await supabase.from('products').insert({
              name: productName,
              description: `${service.name} gift card`,
              type: service.type,
              category_id: categoryId,
              price: priceRub,
              stock: denom.stock,
              is_active: true,
              supplier: 'approute',
              supplier_service_id: service.id,
              denomination_id: denom.id,
            })

            if (!error) importedCount++
          }
        }
      } else {
        // Товары без деноминаций (topup_auto и т.д.)
        const { data: existingProduct } = await supabase
          .from('products')
          .select('id')
          .eq('supplier', 'approute')
          .eq('supplier_service_id', service.id)
          .single()

        const productData = {
          name: service.name,
          description: `${service.name} service`,
          type: service.type,
          category_id: categoryId,
          price: 0, // Для topup цена определяется пользователем
          is_active: true,
          supplier: 'approute',
          supplier_service_id: service.id,
          min_amount: service.min_amount,
          max_amount: service.max_amount,
          supplier_fields: service.fields || null,
        }

        if (existingProduct) {
          const { error } = await supabase
            .from('products')
            .update({
              ...productData,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingProduct.id)

          if (!error) updatedCount++
        } else {
          const { error } = await supabase.from('products').insert(productData)

          if (!error) importedCount++
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported: importedCount,
      updated: updatedCount,
      total: services.length,
    })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Failed to import products' },
      { status: 500 }
    )
  }
}
