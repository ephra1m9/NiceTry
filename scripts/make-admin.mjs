// Назначение администратора по email (для локальной разработки/онбординга).
// Запуск:  node scripts/make-admin.mjs you@example.com
//
// Что делает (через SUPABASE_SERVICE_ROLE_KEY, в обход RLS):
//   1) Создаёт пользователя в auth (email_confirm:true) — если уже есть, пропускает.
//   2) Гарантирует строку в public.users (с уникальным referral_code, статус Bronze).
//   3) Выставляет is_admin = true.
// После этого войди на /auth/login кнопкой «Войти без письма (dev)» этим же email.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function loadEnv() {
  try {
    const raw = readFileSync(join(root, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  } catch {
    /* .env.local может отсутствовать — берём из process.env */
  }
}
loadEnv()

const email = process.argv[2]
if (!email || !email.includes('@')) {
  console.error('Использование: node scripts/make-admin.mjs you@example.com')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Нет NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY в .env.local')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function generateReferralCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

async function findAuthUserByEmail(targetEmail) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const found = data.users.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase())
    if (found) return found
    if (data.users.length < 1000) break
  }
  return null
}

async function main() {
  // 1) auth-пользователь
  const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (createErr && !/registered|already/i.test(createErr.message)) throw createErr
  console.log(createErr ? '• auth-пользователь уже существовал' : '• auth-пользователь создан')

  const authUser = await findAuthUserByEmail(email)
  if (!authUser) throw new Error('Не нашёл auth-пользователя после создания')

  // 2) строка в public.users
  const { data: existing } = await admin
    .from('users')
    .select('id, is_admin')
    .eq('id', authUser.id)
    .maybeSingle()

  if (existing) {
    const { error } = await admin.from('users').update({ is_admin: true }).eq('id', authUser.id)
    if (error) throw error
    console.log('• профиль уже был — выставил is_admin = true')
  } else {
    const { data: bronze } = await admin
      .from('user_statuses')
      .select('id')
      .eq('name', 'Bronze')
      .maybeSingle()

    const { error } = await admin.from('users').insert({
      id: authUser.id,
      email: authUser.email,
      referral_code: generateReferralCode(),
      status_id: bronze?.id ?? null,
      balance: 0,
      is_admin: true,
    })
    if (error) throw error
    console.log('• профиль создан с is_admin = true')
  }

  console.log(`\n✅ Готово. ${email} теперь администратор.`)
  console.log('Дальше: npm run dev → /auth/login → «Войти без письма (dev)» этим email → открой /admin')
}

main().catch((e) => {
  console.error('❌ Ошибка:', e.message || e)
  process.exit(1)
})
