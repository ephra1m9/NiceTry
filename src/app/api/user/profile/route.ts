import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'

// Генерация уникального реферального кода (8 символов A-Z0-9)
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/** Находит ID реферера по реферальному коду из cookie. */
async function resolveReferrer(refCode: string): Promise<string | null> {
  if (!refCode || refCode.length < 4) return null
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('referral_code', refCode.toUpperCase())
    .maybeSingle()
  return data?.id ?? null
}

/** Записывает UTM-клик для пользователя (если были UTM-метки в cookie). */
async function recordUtmClick(userId: string, utmRaw: string | undefined) {
  if (!utmRaw) return
  try {
    const utm = JSON.parse(utmRaw)
    // Находим или создаём UTM-кампанию
    const { data: existing } = await supabaseAdmin
      .from('utm_campaigns')
      .select('id')
      .eq('utm_source', utm.utm_source || '')
      .eq('utm_medium', utm.utm_medium || '')
      .eq('utm_campaign', utm.utm_campaign || '')
      .maybeSingle()
    let campaignId = existing?.id
    if (!campaignId) {
      const { data: created } = await supabaseAdmin
        .from('utm_campaigns')
        .insert({
          utm_source: utm.utm_source || '',
          utm_medium: utm.utm_medium || '',
          utm_campaign: utm.utm_campaign || '',
          utm_term: utm.utm_term || null,
          utm_content: utm.utm_content || null,
        })
        .select('id')
        .single()
      campaignId = created?.id
    }
    if (campaignId) {
      await supabaseAdmin.from('utm_clicks').insert({
        campaign_id: campaignId,
        user_id: userId,
        landing_page: '/',
      })
    }
  } catch {
    // UTM — не критично, молча пропускаем.
  }
}

// GET /api/user/profile - получить (или создать при первом входе) профиль текущего пользователя.
//
// Аутентификация — по сессии пользователя; чтение/создание профиля — через service-role
// (supabaseAdmin), чтобы не зависеть от наличия RLS-политик users_select_own / users_insert_self.
// Иначе при невыставленных политиках новый пользователь не смог бы создать профиль (RLS-deny).
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select(`*, status:user_statuses(name, discount_percent)`)
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      console.error('Profile error:', profileError)
      return NextResponse.json({ error: 'Ошибка получения профиля' }, { status: 500 })
    }

    if (profile) {
      return NextResponse.json(profile)
    }

    // Профиля ещё нет — создаём при первом входе (Bronze, уникальный реф-код).
    const { data: bronzeStatus } = await supabaseAdmin
      .from('user_statuses')
      .select('id')
      .eq('name', 'Bronze')
      .maybeSingle()

    // Атрибуция: читаем реферальный код и UTM из cookies (ставит middleware).
    const refCookie = request.cookies.get('nicetry_ref')?.value
    const utmCookie = request.cookies.get('nicetry_utm')?.value
    const referredBy = refCookie ? await resolveReferrer(refCookie) : null

    const { data: newProfile, error: createError } = await supabaseAdmin
      .from('users')
      .insert({
        id: user.id,
        email: user.email!,
        referral_code: generateReferralCode(),
        status_id: bronzeStatus?.id ?? null,
        balance: 0,
        referred_by: referredBy,
      })
      .select(`*, status:user_statuses(name, discount_percent)`)
      .single()

    if (createError) {
      console.error('Create profile error:', createError)
      return NextResponse.json({ error: 'Ошибка создания профиля' }, { status: 500 })
    }

    // Записать UTM-клик (после создания профиля, чтобы была ссылка на user_id).
    await recordUtmClick(newProfile.id, utmCookie)

    return NextResponse.json(newProfile)
  } catch (error) {
    console.error('Profile error:', error)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

// PATCH /api/user/profile - обновить профиль (разрешено менять ТОЛЬКО собственный telegram_id).
// Чувствительные поля (balance, is_admin, status_id, referral_code) через этот эндпоинт не меняются.
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
    }

    // Белый список изменяемых пользователем полей — только telegram_id.
    const updates: Record<string, unknown> = {}
    if (body.telegram_id !== undefined) {
      // Пустая строка → сброс привязки (null).
      updates.telegram_id = body.telegram_id === '' || body.telegram_id === null ? null : body.telegram_id
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select(`*, status:user_statuses(name, discount_percent)`)
      .single()

    if (updateError) {
      console.error('Update profile error:', updateError)
      // Конфликт уникальности telegram_id (привязка занята другим аккаунтом).
      if (updateError.code === '23505') {
        return NextResponse.json(
          { error: 'Этот Telegram уже привязан к другому аккаунту' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'Ошибка обновления профиля' }, { status: 500 })
    }

    return NextResponse.json(updatedProfile)
  } catch (error) {
    console.error('Update profile error:', error)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
