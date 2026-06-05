import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendAuthCode, ResendSendError } from '@/lib/resend'
import {
  generateCode,
  hashCode,
  codeTtlMinutes,
  normalizeEmail,
  isValidEmail,
} from '@/lib/auth/codes'
import { rateLimit, clientIp } from '@/lib/rate-limit'

// POST /api/auth/send-code — отправить код для ВХОДА в новой сессии.
//
// Тело: { identifier } — почта ИЛИ ник.
//   - почта  → шлём код (работает и для регистрации: новый email получит код, после verify
//              создастся сессия и профиль — как было задумано «введите email, создадим автоматически»).
//   - ник    → находим привязанную почту по LOWER(nickname); шлём код на неё.
//              Если ника нет — отвечаем ОБЩИМ успехом и НЕ шлём письмо (не раскрываем, какие ники
//              существуют). Тогда злоумышленник не отличит существующий ник от несуществующего.
//
// Сессию здесь НЕ выдаём — только отправляем код. Вход завершает /api/auth/verify-code.
//
// Анти-флуд: не чаще 1 кода в 60с на почту; не больше 6 в час на почту; плюс лимит по IP.

const PER_EMAIL_COOLDOWN_MS = 60 * 1000
const PER_EMAIL_HOURLY_LIMIT = 6
const PER_IP_HOURLY_LIMIT = 30

/** Generic-ответ: одинаков и когда письмо ушло, и когда аккаунт по нику не найден. */
function genericOk() {
  return NextResponse.json({
    ok: true,
    message: 'Если аккаунт существует, мы отправили код на вашу почту',
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const identifierRaw: string = (body?.identifier ?? '').toString().trim()
    if (!identifierRaw) {
      return NextResponse.json({ error: 'Укажите ник или email' }, { status: 400 })
    }

    // Лимит по IP (грубый барьер от массового перебора с одного источника).
    const ip = clientIp(request.headers)
    const ipLimit = rateLimit(`send-code:ip:${ip}`, PER_IP_HOURLY_LIMIT, 60 * 60 * 1000)
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } },
      )
    }

    // Разрешаем identifier → email.
    let email: string | null = null
    if (identifierRaw.includes('@')) {
      const normalized = normalizeEmail(identifierRaw)
      if (!isValidEmail(normalized)) {
        return NextResponse.json({ error: 'Некорректный email' }, { status: 400 })
      }
      email = normalized
    } else {
      // Это ник — ищем привязанную почту (регистронезависимо).
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('email')
        .ilike('nickname', identifierRaw)
        .maybeSingle()
      if (!user?.email) {
        // Ник не найден — не раскрываем это. Тратим «слот» лимитера по IP уже учли выше.
        return genericOk()
      }
      email = normalizeEmail(user.email)
    }

    // Анти-флуд по почте: cooldown 60с.
    const cooldown = rateLimit(`send-code:cooldown:${email}`, 1, PER_EMAIL_COOLDOWN_MS)
    if (!cooldown.ok) {
      return NextResponse.json(
        { error: `Код уже отправлен. Повторить можно через ${cooldown.retryAfterSec} с.` },
        { status: 429, headers: { 'Retry-After': String(cooldown.retryAfterSec) } },
      )
    }
    // Часовой лимит на почту.
    const hourly = rateLimit(`send-code:hourly:${email}`, PER_EMAIL_HOURLY_LIMIT, 60 * 60 * 1000)
    if (!hourly.ok) {
      return NextResponse.json(
        { error: 'Слишком много запросов кода. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(hourly.retryAfterSec) } },
      )
    }

    // Генерируем код, сохраняем хеш + срок, отправляем письмо.
    const code = generateCode()
    const ttlMin = codeTtlMinutes()
    const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString()

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('auth_codes')
      .insert({
        email,
        code_hash: hashCode(email, code),
        expires_at: expiresAt,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('send-code insert error:', insertError)
      return NextResponse.json({ error: 'Не удалось создать код. Попробуйте позже.' }, { status: 500 })
    }

    try {
      await sendAuthCode(email, code, inserted.id)
    } catch (e) {
      if (e instanceof ResendSendError) {
        // Подчищаем созданный код, чтобы не копить мусор и не «съедать» попытки.
        await supabaseAdmin.from('auth_codes').delete().eq('id', inserted.id)
        if (e.kind === 'rate_limit') {
          return NextResponse.json(
            { error: 'Сервис отправки перегружен. Попробуйте через минуту.' },
            { status: 429 },
          )
        }
        // no_key/invalid_config/server — общая внятная ошибка, детали уже в логах.
        return NextResponse.json(
          { error: 'Не удалось отправить код. Попробуйте позже.' },
          { status: 502 },
        )
      }
      throw e
    }

    return genericOk()
  } catch (error) {
    console.error('send-code error:', error)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
