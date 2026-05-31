import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createOrder as createAppRouteOrder } from '@/lib/approute'

/**
 * POST /api/orders/create
 * Создание заказа с автовыдачей для instant товаров
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Проверка авторизации
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { items, payment_method, total_amount, discount_amount, final_amount, promo_code } = body

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Корзина пуста' },
        { status: 400 }
      )
    }

    // Получаем профиль пользователя
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('*, status:user_statuses(*)')
      .eq('id', authUser.id)
      .single()

    if (userError || !userProfile) {
      return NextResponse.json(
        { error: 'Профиль пользователя не найден' },
        { status: 404 }
      )
    }

    // Проверка баланса при оплате с баланса
    if (payment_method === 'balance' && userProfile.balance < final_amount) {
      return NextResponse.json(
        { error: 'Недостаточно средств на балансе' },
        { status: 400 }
      )
    }

    // Генерация номера заказа
    const orderNumber = `NT${Date.now()}`

    // Создание заказа
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: authUser.id,
        total_amount,
        discount_amount,
        final_amount,
        status: 'new',
        payment_method,
        supplier_reference_id: `REF${Date.now()}`,
      })
      .select()
      .single()

    if (orderError || !order) {
      console.error('Order creation error:', orderError)
      return NextResponse.json(
        { error: 'Ошибка создания заказа' },
        { status: 500 }
      )
    }

    // Создание позиций заказа и обработка товаров
    const orderItems = []
    const deliveredItems = []

    for (const item of items) {
      // Получаем товар из БД
      const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', item.product_id)
        .single()

      if (!product) continue

      let voucherCode = null
      let deliveryStatus = 'pending'

      // Обработка instant товаров - автовыдача ключа
      if (product.type === 'instant') {
        // Получаем доступный ключ
        const { data: key, error: keyError } = await supabase
          .from('product_keys')
          .select('*')
          .eq('product_id', product.id)
          .eq('is_used', false)
          .limit(1)
          .single()

        if (key && !keyError) {
          voucherCode = key.key_value
          deliveryStatus = 'delivered'

          // Помечаем ключ как использованный
          await supabase
            .from('product_keys')
            .update({
              is_used: true,
              used_at: new Date().toISOString(),
              used_by: authUser.id,
              order_id: order.id,
            })
            .eq('id', key.id)

          deliveredItems.push({
            product_name: product.name,
            voucher_code: voucherCode,
          })
        }
      }

      // Создание позиции заказа
      const { error: itemError } = await supabase.from('order_items').insert({
        order_id: order.id,
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        price: item.price,
        voucher_code: voucherCode,
        delivery_status: deliveryStatus,
      })

      if (itemError) {
        console.error('Order item creation error:', itemError)
      }

      orderItems.push({
        product_name: product.name,
        quantity: item.quantity,
        price: item.price,
        voucher_code: voucherCode,
      })
    }

    // Обновление статуса заказа
    const allDelivered = orderItems.every((item) => item.voucher_code)
    const newStatus = allDelivered ? 'delivered' : 'paid'

    await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', order.id)

    // Списание средств с баланса
    if (payment_method === 'balance') {
      const { error: balanceError } = await supabase
        .from('users')
        .update({
          balance: userProfile.balance - final_amount,
        })
        .eq('id', authUser.id)

      if (balanceError) {
        console.error('Balance update error:', balanceError)
      }

      // Создание транзакции
      await supabase.from('balance_transactions').insert({
        user_id: authUser.id,
        amount: -final_amount,
        type: 'purchase',
        description: `Оплата заказа ${orderNumber}`,
        order_id: order.id,
      })
    }

    // Начисление реферальных бонусов
    if (userProfile.referred_by) {
      const referralPercent = 12 // Можно брать из referral_settings
      const referralAmount = (final_amount * referralPercent) / 100

      // Получаем текущий баланс реферера
      const { data: referrer } = await supabase
        .from('users')
        .select('balance')
        .eq('id', userProfile.referred_by)
        .single()

      if (referrer) {
        await supabase
          .from('users')
          .update({
            balance: Number(referrer.balance) + referralAmount,
          })
          .eq('id', userProfile.referred_by)

        await supabase.from('referral_earnings').insert({
          referrer_id: userProfile.referred_by,
          referred_user_id: authUser.id,
          order_id: order.id,
          amount: referralAmount,
        })

        await supabase.from('balance_transactions').insert({
          user_id: userProfile.referred_by,
          amount: referralAmount,
          type: 'referral',
          description: `Реферальный бонус за заказ ${orderNumber}`,
          order_id: order.id,
        })
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        order_number: orderNumber,
        status: newStatus,
        items: orderItems,
        delivered_items: deliveredItems,
      },
    })
  } catch (error) {
    console.error('Order creation error:', error)
    return NextResponse.json(
      { error: 'Ошибка создания заказа' },
      { status: 500 }
    )
  }
}
