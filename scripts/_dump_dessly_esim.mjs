// Дамп сырого ответа боевого Dessly /api/v1/catalog/esim/products (+ deatil по нескольким
// variant_id): реальные значения geo_scope / esim_package_type / структура attributes, есть ли
// дубли по country, сколько вообще вариантов на каждый тип пакета. Нужен, потому что
// dessly-openapi.json описывает attributes как "набор полей может отличаться" — без живого
// ответа дальше гадать бессмысленно.
//
// Запуск (на сервере/машине с белым IP у Dessly, где реально лежит .env.local с ключами):
//   node scripts/_dump_dessly_esim.mjs
//
// Ничего не пишет в БД и не создаёт заказов — только GET-запросы к каталогу.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHmac } from 'node:crypto'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const envFile of ['.env.local', '.env.production', '.env']) {
  try {
    for (const l of readFileSync(join(root, envFile), 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  } catch {
    /* файла нет — пропускаем */
  }
}

const baseUrl = (process.env.DESSLY_BASE_URL || 'https://desslyhub.com').trim().replace(/\/+$/, '')
const apiKey = (process.env.DESSLY_API_KEY || '').trim()
const apiSecret = (process.env.DESSLY_API_SECRET || '').trim()
if (!apiKey || !apiSecret) {
  console.error('DESSLY_API_KEY / DESSLY_API_SECRET не найдены в .env.local/.env.production/.env')
  process.exit(1)
}

function sign(timestamp, body) {
  return createHmac('sha256', apiSecret).update(`${apiKey}${timestamp}${body}`).digest('hex')
}

async function desslyGet(path) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const res = await fetch(baseUrl + path, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Api-Key': apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': sign(timestamp, ''),
    },
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)

log('base', baseUrl, '→ GET /api/v1/catalog/esim/products')
const list = await desslyGet('/api/v1/catalog/esim/products')
console.log('HTTP', list.status)
if (list.status !== 200) {
  console.log('\n=== ТЕЛО ОТВЕТА (ошибка) ===')
  console.log(JSON.stringify(list.json, null, 2))
  process.exit(1)
}

const variants = Array.isArray(list.json.variants) ? list.json.variants : []
console.log('Всего вариантов на странице:', variants.length, 'next_cursor:', list.json.next_cursor)

// Уникальные значения geo_scope / esim_package_type / country — чтобы понять реальную
// форму данных без догадок.
const geoScopes = new Map()
const packageTypes = new Map()
const countries = new Map()
for (const v of variants) {
  const a = v.attributes || {}
  const gs = String(a.geo_scope ?? '∅')
  const pt = String(a.esim_package_type ?? '∅')
  const c = String(a.country ?? '∅')
  geoScopes.set(gs, (geoScopes.get(gs) || 0) + 1)
  packageTypes.set(pt, (packageTypes.get(pt) || 0) + 1)
  countries.set(c, (countries.get(c) || 0) + 1)
}
console.log('\n=== geo_scope (значение → кол-во) ===')
console.log([...geoScopes.entries()].map(([k, n]) => `${k}: ${n}`).join('\n'))
console.log('\n=== esim_package_type (значение → кол-во) ===')
console.log([...packageTypes.entries()].map(([k, n]) => `${k}: ${n}`).join('\n'))
console.log('\n=== country (значение → кол-во, топ-20) ===')
console.log(
  [...countries.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k, n]) => `${k}: ${n}`)
    .join('\n')
)

// Проверка дублей по имени/описанию — то, на что жалуется заказчик («тарифы дублируются»).
const byName = new Map()
for (const v of variants) byName.set(v.name, (byName.get(v.name) || 0) + 1)
const dupes = [...byName.entries()].filter(([, n]) => n > 1)
console.log('\n=== дубли по name (вариантов с одинаковым именем) ===')
console.log(dupes.length ? dupes.map(([k, n]) => `${k}: ${n}`).join('\n') : '(дублей нет)')

console.log('\n=== первые 5 вариантов целиком (raw) ===')
console.log(JSON.stringify(variants.slice(0, 5), null, 2))

// Детали (с products[]) для первых 2 вариантов каждого встретившегося esim_package_type —
// это покажет реальные ключи в attributes тарифа (ГБ/минуты/смс/срок).
const seenTypes = new Set()
const toDetail = []
for (const v of variants) {
  const pt = String(v.attributes?.esim_package_type ?? '∅')
  if (seenTypes.has(pt)) continue
  seenTypes.add(pt)
  toDetail.push(v.id)
  if (toDetail.length >= 4) break
}
for (const id of toDetail) {
  log(`→ GET /api/v1/catalog/esim/products/${id}`)
  const detail = await desslyGet(`/api/v1/catalog/esim/products/${encodeURIComponent(id)}`)
  console.log(`\n=== detail variant_id=${id} (HTTP ${detail.status}) ===`)
  console.log(JSON.stringify(detail.json, null, 2))
}

process.exit(0)
