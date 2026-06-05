import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  hashCode,
  verifyCodeHash,
  normalizeEmail,
  isValidEmail,
  MAX_CODE_ATTEMPTS,
} from '@/lib/auth/codes'
import { rateLimit, clientIp } from '@/lib/rate-limit'

// POST /api/auth/verify-code — проверить код и ВОЙТИ (выдать Supabase-сессию).
//
// Тело: { identifier | email, code }.
//   - identifier может быть почтой или ником (как в send-code) — резолвим в почту.
//   - Проверяем самый свежий активный код по почте: не истёк, не использован, попытки не превышены,
//     хеш совпал. Успех → consumed_at, минтим Supabase-сессию (см. ниже), профиль создаётся лениво
//     в /api/user/profile при первом обращении (как и раньше).
//
// Как минтим сессию, не ломая Supabase Auth: тот же приём, что и dev-login —
//   admin.createUser (idempotent) → admin.generateLink(magiclink) → verifyOtp(token_hash).
// verifyOtp серверным клиентом пишет сессионные cookies. users.id == auth user id сохраняется,
// поэтому весь остальной код (профиль/заказы/баланс/админка/middleware) работает без изменений.

const PER_IP_HOURLY_LIMIT = 60

async function resolveEmail(identifierRaw: string): Promise<string | null> {
  if (identifierRaw.includes('@')) {
    const normalized = normalizeEmail(identifierRaw)
    return isValidEmail(normalized) ? normalized : null
  }
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email')
    .ilike('nickname', identifierRaw)
    .maybeSingle()
  return user?.email ? normalizeEmail(user.email) : null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const identifierRaw: string = (body?.identifier ?? body?.email ?? '').toString().trim()
    const code: string = (body?.code ?? '').toString().trim()

    if (!identifierRaw || !code) {
      return NextResponse.json({ error: 'Укажите данные и код' }, { status: 400 })
    }

    // Лимит по IP против перебора кодов.
    const ip = clientIp(request.headers)
    const ipLimit = rateLimit(`verify-code:ip:${ip}`, PER_IP_HOURLY_LIMIT, 60 * 60 * 1000)
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: 'Слишком много попыток. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } },
      )
    }

    const email = await resolveEmail(identifierRaw)
    // Не раскрываем, существует ли аккаунт/ник: общая ошибка «неверный код».
    if (!email) {
      return NextResponse.json({ error: 'Неверный или просроченный код' }, { status: 400 })
    }

    // Берём самый свежий неиспользованный код по почте.
    const { data: row } = await supabaseAdmin
      .from('auth_codes')
      .select('id, code_hash, expires_at, attempts, consumed_at')
      .eq('email', email)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!row) {
      return NextResponse.json({ error: 'Неверный или просроченный код' }, { status: 400 })
    }

    // Истёк.
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Код просрочен. Запросите новый.' }, { status: 400 })
    }

    // Превышен лимит попыток — блокируем код (помечаем использованным, чтобы не перебирали дальше).
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await supabaseAdmin.from('auth_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
      return NextResponse.json(
        { error: 'Слишком много неверных попыток. Запросите новый код.' },
        { status: 429 },
      )
    }

    // Проверяем хеш за постоянное время.
    if (!verifyCodeHash(email, code, row.code_hash)) {
      const nextAttempts = row.attempts + 1
      await supabaseAdmin.from('auth_codes').update({ attempts: nextAttempts }).eq('id', row.id)
      const left = Math.max(0, MAX_CODE_ATTEMPTS - nextAttempts)
      return NextResponse.json(
        { error: left > 0 ? `Неверный код. Осталось попыток: ${left}.` : 'Неверный код.' },
        { status: 400 },
      )
    }

    // Код верный → помечаем использованным (одноразовость, защита от гонки повторной отправки).
    const { data: consumed } = await supabaseAdmin
      .from('auth_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle()
    if (!consumed) {
      // Кто-то уже использовал этот код (гонка) — не выдаём вторую сессию.
      return NextResponse.json({ error: 'Код уже использован. Запросите новый.' }, { status: 400 })
    }

    // ——— Минтим Supabase-сессию (как dev-login) ———
    // 1) Гарантируем существование auth-пользователя (email_confirm: код уже подтвердил владение).
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    if (createError && !/registered|already/i.test(createError.message)) {
      console.error('verify-code createUser error:', createError)
      return NextResponse.json({ error: 'Не удалось войти. Попробуйте позже.' }, { status: 500 })
    }

    // 2) Одноразовый token_hash без отправки письма.
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('verify-code generateLink error:', linkError)
      return NextResponse.json({ error: 'Не удалось войти. Попробуйте позже.' }, { status: 500 })
    }

    // 3) Подтверждаем token_hash серверным клиентом → сессия пишется в cookies.
    const supabase = await createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: 'magiclink',
      token_hash: linkData.properties.hashed_token,
    })
    if (verifyError) {
      console.error('verify-code verifyOtp error:', verifyError)
      return NextResponse.json({ error: 'Не удалось войти. Попробуйте позже.' }, { status: 500 })
    }

    // Узнаём, выбран ли уже ник (чтобы фронт решил, показывать ли экран «придумайте ник»).
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('nickname')
      .eq('email', email)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      needsNickname: !profile?.nickname,
    })
  } catch (error) {
    console.error('verify-code error:', error)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
