// Выдача админских прав пользователю через service role (в обход RLS).
// Использование: node scripts/make-admin.mjs ssarycev37@gmail.com
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local')
  const text = readFileSync(envPath, 'utf-8')
  const env = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return env
}

const email = process.argv[2]
if (!email) {
  console.error('Укажи email: node scripts/make-admin.mjs user@example.com')
  process.exit(1)
}

const env = loadEnv()
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: users, error } = await supabase.auth.admin.listUsers()
if (error) { console.error('listUsers error:', error); process.exit(1) }

const target = users.users.find(u => u.email === email)
if (!target) { console.error('Пользователь', email, 'не найден'); process.exit(1) }

console.log('Найден:', target.id, target.email)

const { data: profile } = await supabase.from('users').select('*').eq('id', target.id).maybeSingle()

if (!profile) {
  console.log('Профиля нет — создаём...')
  const { error: insErr } = await supabase.from('users').insert({
    id: target.id, email: target.email, is_admin: true, balance: 0,
    referral_code: 'ADMIN' + Date.now().toString(36).toUpperCase(),
  })
  if (insErr) { console.error('insert error:', JSON.stringify(insErr)); process.exit(1) }
  console.log('Создан с is_admin=true')
} else {
  console.log('Текущий: is_admin =', profile.is_admin, ', баланс =', profile.balance)
  if (!profile.is_admin) {
    const { error: updErr } = await supabase.from('users').update({ is_admin: true }).eq('id', target.id)
    if (updErr) { console.error('update error:', JSON.stringify(updErr)); process.exit(1) }
    console.log('Установлен is_admin = true')
  } else {
    console.log('Уже админ.')
  }
}

const { data: check } = await supabase.from('users').select('id, is_admin, balance').eq('id', target.id).single()
console.log('Итог:', JSON.stringify(check))
console.log('Готово.')
