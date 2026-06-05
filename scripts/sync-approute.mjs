// Синхронизация каталога AppRoute в Supabase.
// Запуск: npm run sync:approute
//
// Источник позиций:
//   - БОЕВОЙ режим (заданы валидные APPROUTE_BASE_URL + APPROUTE_API_KEY): тянет GET /api/v1/services
//     из реального AppRoute, маппит таксономию поставщика → внутренние категории по ключевым словам
//     (src/data/approute-category-map.json).
//   - ФОЛБЭК (ключ/URL — плейсхолдеры): берёт мок-каталог из src/data/catalog.json, чтобы витрина
//     оставалась наполненной без боевого ключа (деградация без ключей, §7 правил сессии).
//
// Идемпотентно: повторный запуск не плодит дубли. Существующие approute-товары находятся по
// бизнес-ключу (supplier_service_id, denomination_id) и обновляются апсертом по первичному ключу id.
// Цена: ceil(usd * rate * (100 + markup) / 100) целочисленным множителем (без off-by-one).
// Регионы PSN (US/PL/DE/FR/TR/IN/UK) разворачиваются в отдельные SKU.
//
// Использует SUPABASE_SERVICE_ROLE_KEY (обходит RLS). Только AppRoute-категории (Dessly — отдельно).

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
    /* .env.local может отсутствовать — используем process.env */
  }
}
loadEnv()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Не заданы NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// Транспорт Supabase через npm-пакет undici с КОРОТКИМ keep-alive.
// На этой сети встроенный в Node undici держит keep-alive-коннект до Supabase, который протухает
// между запросами: первый запрос по дохлому коннекту висит до таймаута (чтения) или рвётся сразу
// ("TypeError: fetch failed" на записи — тело больше). Свой dispatcher с keepAliveTimeout≈сразу
// заставляет брать свежее соединение на каждый запрос. fetch и Agent — из ОДНОГО пакета undici,
// поэтому несовместимости версий (как с глобальным fetch + ProxyAgent) тут нет.
const { fetch: undiciFetch, Agent } = await import('undici')
const sbDispatcher = new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1, connections: 8 })
const sbFetch = (input, init = {}) => undiciFetch(input, { ...init, dispatcher: sbDispatcher })

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
  global: { fetch: sbFetch },
})
const catalog = JSON.parse(readFileSync(join(root, 'src/data/catalog.json'), 'utf8'))
const catMap = JSON.parse(readFileSync(join(root, 'src/data/approute-category-map.json'), 'utf8'))

const PLACEHOLDERS = new Set(['', 'your_approute_api_key', 'your_approute_base_url', 'TODO', 'changeme'])
const baseUrl = (process.env.APPROUTE_BASE_URL || '').trim().replace(/\/+$/, '')
const apiKey = (process.env.APPROUTE_API_KEY || '').trim()
const FORCE_MOCK = process.env.NICETRY_FORCE_SUPPLIER_MOCK === '1'
const isLive =
  !FORCE_MOCK &&
  !PLACEHOLDERS.has(baseUrl) &&
  !PLACEHOLDERS.has(apiKey) &&
  /^https?:\/\//i.test(baseUrl) &&
  apiKey.length > 0

const priceRub = (usd, rate, markup) => Math.ceil((usd * rate * (100 + markup)) / 100)

// Обложка SKU. Зеркало pickImageUrl/serviceImage из src/lib/catalog.ts: берём первое валидное
// абсолютное http(s)-поле из распространённых имён (имя в боевом API уточняется дампом
// scripts/_dump_approute.mjs), иначе дериватив Steam header.jpg по appId сервиса.
const IMAGE_KEYS = [
  'imageUrl', 'image', 'imageURL', 'iconUrl', 'icon', 'logoUrl', 'logo',
  'coverUrl', 'cover', 'pictureUrl', 'picture', 'thumbnailUrl', 'thumbnail', 'imgUrl', 'img',
]
const pickImageUrl = (obj) => {
  if (!obj || typeof obj !== 'object') return null
  for (const k of IMAGE_KEYS) {
    const v = obj[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim()
  }
  return null
}
const steamHeader = (appId) =>
  appId ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` : null
// Логотип бренда по section: боевой AppRoute картинок не отдаёт (см. WORKLOG 2026-06-05), поэтому
// обложку даём логотипом бренда (Google favicon sz=256 по домену из approute-brand-logos.json).
// Зеркало brandLogo() из src/lib/catalog.ts. Родовые section (Mobile, TV…) в карту не входят → null.
const BRAND_DOMAINS = JSON.parse(
  readFileSync(join(root, 'src/data/approute-brand-logos.json'), 'utf8')
).domains
const brandLogo = (section) => {
  const domain = section ? BRAND_DOMAINS[section.trim()] : null
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=256` : null
}
const serviceImage = (svc, den) =>
  pickImageUrl(den) ?? pickImageUrl(svc) ?? steamHeader(svc.appId) ?? brandLogo(svc.section)

// Таймауты запросов (чтобы синк не висел бесконечно) и размер пачки записи.
// BATCH_SIZE=25: на боевом прогоне 2026-06-05 эта сеть рвёт POST-тела к Supabase больше ~28КБ
// ("TypeError: fetch failed" детерминированно на ВСЕХ ретраях). Замер (_test_batch.mjs):
// пачка 50 строк (~28КБ) падает всегда, 25 строк (~14КБ) проходит с первой попытки. Берём 25.
// Чтения идут страницами по 200 (GET, тело в ответе — другое направление, оно ок).
// Переопределяется через SYNC_BATCH_SIZE (поднять, если сеть лучше; снизить до 10 при обрывах).
const FETCH_TIMEOUT_MS = Number(process.env.SYNC_FETCH_TIMEOUT_MS || 60000)
const DB_TIMEOUT_MS = Number(process.env.SYNC_DB_TIMEOUT_MS || 30000)
const BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE || 25)
const DB_RETRIES = Number(process.env.SYNC_DB_RETRIES || 4)

const chunk = (arr, n) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Повтор с экспоненциальной паузой: при больших POST-телах undici иногда роняет соединение
// ("TypeError: fetch failed" / ECONNRESET). Несколько ретраев делают батчевую запись надёжной.
async function withRetry(label, fn) {
  let lastErr
  for (let attempt = 1; attempt <= DB_RETRIES; attempt++) {
    try {
      const { data, error } = await fn()
      if (!error) return data
      lastErr = new Error(error.message)
    } catch (e) {
      lastErr = e
    }
    if (attempt < DB_RETRIES) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.log(`  ! ${label}: попытка ${attempt} не удалась (${lastErr.message}), повтор через ${backoff}ms`)
      await sleep(backoff)
    }
  }
  throw new Error(`${label}: исчерпаны ${DB_RETRIES} попыток: ${lastErr.message}`)
}

// Маппинг сервиса AppRoute → внутренний slug по ключевым словам (зеркало src/lib/approute/category-map.ts).
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

// Боевой запрос списка сервисов AppRoute (envelope { data: { items } }).
async function fetchLiveServices() {
  // Тот же исходящий прокси, что и в src/lib/approute/client.ts: при заданном
  // APPROUTE_OUTBOUND_PROXY гоним запрос через VPS со статичным IP (вайтлист постоянного токена).
  //
  // ВАЖНО: используем undici.request, а НЕ глобальный fetch. Глобальный fetch в Node работает
  // на встроенном undici, а ProxyAgent мы создаём из npm-пакета undici — dispatcher из одного
  // undici, переданный в fetch из другого, рвёт соединение ("TypeError: fetch failed").
  // undici.request + ProxyAgent из одного пакета работает стабильно (см. scripts/_test_undici.mjs).
  const { request, ProxyAgent } = await import('undici')
  const proxyUrl = (process.env.APPROUTE_OUTBOUND_PROXY || '').trim()
  const opts = {
    method: 'GET',
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    headersTimeout: FETCH_TIMEOUT_MS, // не висим бесконечно на egress
    bodyTimeout: FETCH_TIMEOUT_MS,
  }
  if (proxyUrl) opts.dispatcher = new ProxyAgent({ uri: proxyUrl })
  const res = await request(baseUrl + '/api/v1/services', opts)
  const env = await res.body.json()
  // statusCode 0/1/2 — не ошибка (см. types.ts). Иначе бросаем.
  if (![0, 1, 2].includes(env.statusCode)) {
    throw new Error(`AppRoute error statusCode=${env.statusCode}: ${env.statusMessage || ''}`)
  }
  return env.data?.items ?? []
}

// Фолбэк: сервисы из мок-каталога в форме AppRouteService.
function fallbackServices() {
  return catalog.approuteServices.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.ordersType,
    categoryName: s.categorySlug,
    description: s.description,
    minAmountUsd: s.minAmountUsd,
    maxAmountUsd: s.maxAmountUsd,
    regions: s.regions,
    fields: s.fields,
    items: s.items,
  }))
}

async function run() {
  console.log(isLive ? 'AppRoute: БОЕВОЙ режим (реальный API)' : 'AppRoute: ФОЛБЭК (мок-каталог из catalog.json)')

  // 1) Категории AppRoute (без dessly-games) → upsert, карта slug→id.
  const slugToId = {}
  const rateBySlug = {}
  const markupBySlug = {}
  const approuteCats = catalog.categories.filter((c) => c.supplier === 'approute')
  for (const c of approuteCats) {
    rateBySlug[c.slug] = c.usd_to_rub_rate
    markupBySlug[c.slug] = c.markup_percent
    const { data: existing } = await supabase.from('categories').select('id').eq('slug', c.slug).maybeSingle()
    const row = {
      name: c.name, slug: c.slug, icon: c.icon, markup_percent: c.markup_percent,
      usd_to_rub_rate: c.usd_to_rub_rate, supplier: c.supplier, is_active: true, sort_order: c.sort_order,
    }
    if (existing) {
      await supabase.from('categories').update(row).eq('id', existing.id)
      slugToId[c.slug] = existing.id
    } else {
      const { data } = await supabase.from('categories').insert(row).select('id').single()
      slugToId[c.slug] = data?.id
    }
  }

  // 2) Сервисы → товары.
  //
  // Раньше тут был пер-товарный SELECT-then-INSERT/UPDATE: ~1.6с на SKU × 2193 ≈ 60 мин.
  // Теперь — батчево:
  //   а) ОДИН раз префетчим карту существующих approute-товаров (supplier_service_id, denomination_id) → id
  //      (с пагинацией: PostgREST отдаёт максимум 1000 строк за запрос);
  //   б) строим все строки в памяти, проставляя id уже существующим;
  //   в) пишем пачками по BATCH_SIZE: новые — insert, существующие — upsert по первичному ключу id.
  // Идемпотентность держится на бизнес-ключе (service_id, denomination_id) без отдельного UNIQUE-индекса:
  // конфликт разрешается по уже существующему id (PK). Опциональный UNIQUE-индекс на бизнес-колонки —
  // в migrations/2026-06-05_products_unique_supplier_sku.sql (защита от дублей на уровне БД).
  const services = isLive ? await fetchLiveServices() : fallbackServices()
  console.log(`Сервисов от поставщика: ${services.length}`)

  // Ключ бизнес-идентичности SKU. Разделитель "::" исключает склейку-коллизию
  // ("12"+"3" против "1"+"23"); null denomination_id кодируем сентинелом.
  const keyOf = (serviceId, denomId) => `${serviceId}::${denomId == null ? '<null>' : denomId}`

  // а) Префетч существующих approute-товаров с пагинацией.
  // Страница 200 + ретраи: на этой сети undici рвёт крупные тела ("TypeError: terminated" /
  // TimeoutError на странице 1000), мелкие страницы с повтором проходят надёжно (как в _count.mjs).
  const existingByKey = new Map()
  {
    const PAGE = 200
    let offset = 0
    for (;;) {
      const data = await withRetry(`Префетч существующих (offset ${offset})`, () =>
        supabase
          .from('products')
          .select('id, supplier_service_id, denomination_id')
          .eq('supplier', 'approute')
          .range(offset, offset + PAGE - 1)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      )
      for (const r of data) existingByKey.set(keyOf(r.supplier_service_id, r.denomination_id), r.id)
      if (data.length < PAGE) break
      offset += PAGE
    }
  }
  console.log(`Существующих approute-товаров в БД: ${existingByKey.size}`)

  // б) Сборка строк.
  const rows = []
  let skipped = 0
  let sort = 0
  const pushRow = (rowData) => {
    const id = existingByKey.get(keyOf(rowData.supplier_service_id, rowData.denomination_id))
    if (id) rowData.id = id // существующий → upsert по PK обновит его
    rows.push(rowData)
  }

  for (const svc of services) {
    const slug = mapServiceToSlug(svc)
    if (!slug || !slugToId[slug]) {
      skipped++
      continue
    }
    const categoryId = slugToId[slug]
    const rate = rateBySlug[slug]
    const markup = markupBySlug[slug]

    if (svc.type === 'dtu') {
      const denomId = svc.items?.[0]?.id || null
      pushRow({
        name: svc.name, description: svc.description || '', type: 'topup_auto', category_id: categoryId,
        price: 0, is_active: true, supplier: 'approute', supplier_service_id: svc.id, denomination_id: denomId,
        min_amount: priceRub(svc.minAmountUsd ?? 1, rate, markup),
        max_amount: priceRub(svc.maxAmountUsd ?? 500, rate, markup),
        supplier_fields: svc.fields || null, image_url: serviceImage(svc), sort_order: sort++,
      })
    } else {
      const regions = svc.regions && svc.regions.length ? svc.regions : [null]
      for (const den of svc.items) {
        for (const region of regions) {
          const denomId = region ? `${den.id}_${region.toLowerCase()}` : den.id
          const nameSuffix = region ? ` (${region})` : ''
          // Боевой API отдаёт inStock как количество (число), а не boolean (тип в types.ts —
          // упрощение). Приводим: stock = реальный остаток, is_active = есть ли остаток.
          const stockNum = typeof den.inStock === 'number' ? den.inStock : den.inStock ? 100 : 0
          pushRow({
            name: `${svc.name} — ${den.name}${nameSuffix}`, description: svc.description || '', type: 'instant',
            category_id: categoryId, price: priceRub(den.price, rate, markup),
            stock: stockNum, is_active: stockNum > 0, supplier: 'approute',
            supplier_service_id: svc.id, denomination_id: denomId,
            image_url: serviceImage(svc, den), sort_order: sort++,
          })
        }
      }
    }
  }

  // в) Запись пачками. Новые и существующие — отдельными пачками, чтобы набор колонок в каждой
  //    пачке был однородным (для новых id опущен → срабатывает DEFAULT gen_random_uuid()).
  const toInsert = rows.filter((r) => !r.id)
  const toUpdate = rows.filter((r) => r.id)
  let imported = 0
  let updated = 0

  for (const part of chunk(toInsert, BATCH_SIZE)) {
    await withRetry(`Вставка пачки (${part.length})`, () =>
      supabase.from('products').insert(part).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    )
    imported += part.length
    console.log(`  + добавлено ${imported}/${toInsert.length}`)
  }

  for (const part of chunk(toUpdate, BATCH_SIZE)) {
    await withRetry(`Обновление пачки (${part.length})`, () =>
      supabase.from('products').upsert(part, { onConflict: 'id' }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    )
    updated += part.length
    console.log(`  ~ обновлено ${updated}/${toUpdate.length}`)
  }

  // г) Prune: удаляем approute-строки, которых нет в текущем фиде (сироты прошлых синков
  //    и возможные дубли). Делает синк конвергентным — БД точно отражает каталог поставщика.
  //    ВКЛЮЧАЕТСЯ ЯВНО: по умолчанию НЕ удаляет ничего (обычный синк безопасен).
  //      SYNC_PRUNE=dry  → только показать список сирот (без удаления);
  //      SYNC_PRUNE=1    → реально удалить.
  //    Сейф-гард: только боевой режим и только если фид полный (порог SYNC_PRUNE_MIN) —
  //    чтобы частичный/сбойный фид не выкосил живой каталог.
  let pruned = 0
  const PRUNE_MODE = (process.env.SYNC_PRUNE || '').trim() // '', 'dry', '1'
  const MIN_FOR_PRUNE = Number(process.env.SYNC_PRUNE_MIN || 1000)
  if (isLive && PRUNE_MODE && rows.length >= MIN_FOR_PRUNE) {
    const currentKeys = new Set(rows.map((r) => keyOf(r.supplier_service_id, r.denomination_id)))
    // Перечитываем ВСЕ approute-строки (id+ключ) с пагинацией и ретраями — на этой сети
    // undici рвёт крупные тела, поэтому страница умеренная.
    const orphanIds = []
    {
      const PAGE = 500
      let offset = 0
      for (;;) {
        const data = await withRetry(`Чтение approute (offset ${offset})`, () =>
          supabase
            .from('products')
            .select('id, supplier_service_id, denomination_id')
            .eq('supplier', 'approute')
            .range(offset, offset + PAGE - 1)
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
        )
        for (const r of data) {
          if (!currentKeys.has(keyOf(r.supplier_service_id, r.denomination_id))) orphanIds.push(r.id)
        }
        if (data.length < PAGE) break
        offset += PAGE
      }
    }
    for (const part of chunk(orphanIds, BATCH_SIZE)) {
      await withRetry(`Удаление сирот (${part.length})`, () =>
        supabase.from('products').delete().in('id', part).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      )
      pruned += part.length
      console.log(`  - удалено сирот ${pruned}/${orphanIds.length}`)
    }
  } else if (isLive) {
    console.log(`Prune пропущен: в фиде только ${rows.length} позиций (< ${MIN_FOR_PRUNE}), не рискуем чистить`)
  }

  console.log(`Категорий AppRoute: ${approuteCats.length}`)
  console.log(`Товаров: добавлено ${imported}, обновлено ${updated}, пропущено (вне категорий) ${skipped}`)
  console.log(`Всего SKU обработано: ${rows.length}`)
  console.log('Готово.')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
