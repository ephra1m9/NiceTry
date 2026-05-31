import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/promo/validate
 * Проверить валидность промокода
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { code } = await request.json()

    if (!code) {
      return NextResponse.json(
        { valid: false, error: 'Промокод не указан' },
        { status: 400 }
      )
    }

    // Получаем промокод из БД
    const { data: promo, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single()

    if (error || !promo) {
      return NextResponse.json({
        valid: false,
        error: 'Промокод не найден или неактивен',
      })
    }

    // Проверка срока действия
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return NextResponse.json({
        valid: false,
        error: 'Срок действия промокода истёк',
      })
    }

    // Проверка лимита использований
    if (promo.max_uses && promo.used_count >= promo.max_uses) {
      return NextResponse.json({
        valid: false,
        error: 'Промокод исчерпан',
      })
    }

    return NextResponse.json({
      valid: true,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
    })
  } catch (error) {
    console.error('Promo validation error:', error)
    return NextResponse.json(
      { valid: false, error: 'Ошибка проверки промокода' },
      { status: 500 }
    )
  }
}
