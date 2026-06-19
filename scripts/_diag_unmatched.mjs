// Диагностика: какие сервисы боевого AppRoute не матчатся ни на один внутренний slug
// (mapServiceToSlug), и почему. Печатает их name/categoryName/subcategoryName/section,
// плюс сводку по всем замапленным категориям. Не пишет в БД. Запуск: node scripts/_diag_unmatched.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  for (const l of readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
} catch { /* .env.local может отсутствовать на сервере, тогда переменные берём из окружения контейнера */ }

const catMap = JSON.parse(readFileSync(join(root, 'src/data/approute-category-map.json'), 'utf8'))
const KNOWN = new Set(catMap.categories.map((c) => c.slug))

function mapServiceToSlug(svc) {
  if (svc.categoryName && KNOWN.has(svc.categoryName)) return svc.categoryName
  const hay = [svc.categoryName, svc.subcategoryName, svc.section, svc.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!hay.trim()) return null
  for (const entry of catMap.categories) {
    if (entry.keywords.some((kw) => hay.includes(kw.toLowerCase()))) return entry.slug
  }
  return null
}

const baseUrl = (process.env.APPROUTE_BASE_URL || '').trim().replace(/\/+$/, '')
const apiKey = (process.env.APPROUTE_API_KEY || '').trim()
const proxyUrl = (process.env.APPROUTE_OUTBOUND_PROXY || '').trim()

const { request, ProxyAgent } = await import('undici')
const opts = {
  method: 'GET',
  headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  headersTimeout: 60000,
  bodyTimeout: 60000,
}
if (proxyUrl) opts.dispatcher = new ProxyAgent({ uri: proxyUrl })

console.log('Запрос /api/v1/services...')
const res = await request(baseUrl + '/api/v1/services', opts)
const env = await res.body.json()
const items = env.data?.items ?? []
console.log(`HTTP ${res.statusCode}, statusCode ${env.statusCode}, сервисов: ${items.length}\n`)

const bySlug = new Map()
const unmatched = []
for (const svc of items) {
  const slug = mapServiceToSlug(svc)
  if (slug) {
    bySlug.set(slug, (bySlug.get(slug) || 0) + 1)
  } else {
    unmatched.push(svc)
  }
}

console.log('=== Сматчено по slug ===')
for (const [slug, n] of [...bySlug.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${slug}: ${n}`)
}

console.log(`\n=== Не сматчено: ${unmatched.length} ===`)
for (const svc of unmatched.slice(0, 60)) {
  console.log(
    `  name="${svc.name}" categoryName="${svc.categoryName ?? ''}" subcategoryName="${svc.subcategoryName ?? ''}" section="${svc.section ?? ''}"`
  )
}
if (unmatched.length > 60) console.log(`  ...и ещё ${unmatched.length - 60}`)
