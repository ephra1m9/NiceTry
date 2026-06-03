// Единый аккаунт «сайт ↔ бот ↔ Mini App».
//
// Канонической связью служит существующее поле users.telegram_id (UNIQUE). Все операции идут
// через service-role (supabaseAdmin), обходя RLS, но только после доказанной подлинности
// Telegram-пользователя (проверка initData / подпись deep-link токена в вызывающем коде).
//
// Сценарии (ТЗ §5.7):
//   • telegram-first: пользователь впервые пишет боту → ensureTelegramUser создаёт auth-пользователя
//     с синтетическим email + профиль, привязанный к telegram_id (без дублей при гонке).
//   • email-first:    пользователь уже зарегистрирован по email → linkTelegramToUser привязывает
//     telegram_id к его аккаунту. Конфликт (этот Telegram уже у другого аккаунта) запрещён и
//     сопровождается предупреждением; пустой авто-аккаунт (без заказов и баланса) безопасно
//     сливается, чтобы не плодить дубли.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { syntheticEmail } from './config'
import type { TelegramUser } from './verify'

export interface UserProfile {
  id: string
  email: string
  telegram_id: number | null
  telegram_username: string | null
  balance: number
  referral_code: string
  is_admin?: boolean
  [key: string]: unknown
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
  return code
}

async function bronzeStatusId(): Promise<string | null> {
  const { data } = await supabaseAdmin.from('user_statuses').select('id').eq('name', 'Bronze').maybeSingle()
  return data?.id ?? null
}

/** Поиск профиля по telegram_id. */
export async function findUserByTelegramId(telegramId: number): Promise<UserProfile | null> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  return (data as UserProfile) ?? null
}

/**
 * Гарантирует наличие аккаунта для Telegram-пользователя (telegram-first).
 * Возвращает профиль (существующий или только что созданный).
 */
export async function ensureTelegramUser(tg: TelegramUser): Promise<UserProfile> {
  const existing = await findUserByTelegramId(tg.id)
  if (existing) {
    // Подтянуть username, если изменился.
    if (tg.username && existing.telegram_username !== tg.username) {
      await supabaseAdmin.from('users').update({ telegram_username: tg.username }).eq('id', existing.id)
      existing.telegram_username = tg.username
    }
    return existing
  }

  const email = syntheticEmail(tg.id)

  // 1) auth-пользователь (для выдачи сессии в Mini App тем же механизмом, что magic link).
  let authId: string | undefined
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { telegram_id: tg.id, source: 'telegram' },
  })
  if (created?.user) {
    authId = created.user.id
  } else if (createErr && /registered|already/i.test(createErr.message)) {
    // auth-пользователь уже есть (повторный /start до создания профиля) — находим его id.
    const { data: list } = await supabaseAdmin.auth.admin.listUsers()
    authId = list?.users?.find((u) => u.email === email)?.id
  }
  if (!authId) throw new Error(`Не удалось создать Telegram-пользователя: ${createErr?.message || 'unknown'}`)

  // 2) профиль.
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('users')
    .insert({
      id: authId,
      email,
      telegram_id: tg.id,
      telegram_username: tg.username ?? null,
      referral_code: generateReferralCode(),
      status_id: await bronzeStatusId(),
      balance: 0,
    })
    .select('*')
    .maybeSingle()

  if (profile) return profile as UserProfile

  // Гонка: профиль/привязка уже созданы параллельным апдейтом — перечитываем по telegram_id.
  if (profErr) {
    const again = await findUserByTelegramId(tg.id)
    if (again) return again
    // Либо профиль для этого authId уже есть, но без telegram_id — дочиняем.
    const { data: byId } = await supabaseAdmin.from('users').select('*').eq('id', authId).maybeSingle()
    if (byId) return byId as UserProfile
    throw new Error(`Не удалось создать профиль Telegram-пользователя: ${profErr.message}`)
  }
  throw new Error('Не удалось создать профиль Telegram-пользователя')
}

export type LinkResult =
  | { ok: true; merged: boolean; profile: UserProfile }
  | { ok: false; reason: 'conflict'; conflictUserId: string }
  | { ok: false; reason: 'not_found' }

/**
 * Привязывает telegram_id к существующему аккаунту сайта (email-first).
 * — Идемпотентно: если уже привязан к этому же аккаунту → ok.
 * — Конфликт: telegram_id занят непустым аккаунтом → reason:'conflict'.
 * — Слияние: занят ПУСТЫМ авто-аккаунтом (без заказов, баланс 0) → авто-аккаунт удаляется,
 *   привязка переносится (merged:true).
 */
export async function linkTelegramToUser(userId: string, tg: TelegramUser): Promise<LinkResult> {
  const { data: target } = await supabaseAdmin.from('users').select('*').eq('id', userId).maybeSingle()
  if (!target) return { ok: false, reason: 'not_found' }

  const holder = await findUserByTelegramId(tg.id)
  if (holder) {
    if (holder.id === userId) {
      // Уже привязан к этому аккаунту — обновим username и выйдем.
      if (tg.username && holder.telegram_username !== tg.username) {
        await supabaseAdmin.from('users').update({ telegram_username: tg.username }).eq('id', userId)
      }
      return { ok: true, merged: false, profile: { ...(target as UserProfile), telegram_id: tg.id } }
    }

    // telegram_id занят другим аккаунтом. Пытаемся безопасно слить пустой авто-аккаунт.
    const empty = await isAccountEmpty(holder.id)
    if (!empty) return { ok: false, reason: 'conflict', conflictUserId: holder.id }

    // Освобождаем telegram_id у пустого авто-аккаунта и удаляем его.
    await supabaseAdmin.from('users').update({ telegram_id: null }).eq('id', holder.id)
    await supabaseAdmin.from('users').delete().eq('id', holder.id)
    await supabaseAdmin.auth.admin.deleteUser(holder.id).catch(() => {})
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ telegram_id: tg.id, telegram_username: tg.username ?? null })
    .eq('id', userId)

  if (error) {
    // Уникальное ограничение (гонка) — телеграм заняли между проверкой и записью.
    if ((error as { code?: string }).code === '23505') {
      const h = await findUserByTelegramId(tg.id)
      return { ok: false, reason: 'conflict', conflictUserId: h?.id ?? 'unknown' }
    }
    throw new Error(error.message)
  }

  return { ok: true, merged: Boolean(holder), profile: { ...(target as UserProfile), telegram_id: tg.id } }
}

/** Аккаунт «пустой» (можно слить), если нет ни одного заказа и нулевой баланс. */
async function isAccountEmpty(userId: string): Promise<boolean> {
  const { data: orders } = await supabaseAdmin.from('orders').select('id').eq('user_id', userId).limit(1)
  if (orders && orders.length > 0) return false
  const { data: u } = await supabaseAdmin.from('users').select('balance').eq('id', userId).maybeSingle()
  return Number(u?.balance || 0) === 0
}
