// Единый построитель каталога из поставщиков (AppRoute + Dessly) + ручные товары.
// Используется:
//   1) импортёром /api/products/import — запись в Supabase (боевой путь);
//   2) фолбэком витрины (/api/products, /api/products/[id], /api/categories), когда БД
//      пуста или недоступна — чтобы каталог был виден сразу, ещё до сидинга/ключей.
//
// Формула цены (§5.3 ТЗ): price_rub = ceil(price_usd * usd_to_rub_rate * (1 + markup%/100)).
// Наценка и курс берутся из категории (плейсхолдеры в catalog.json, редактируются в админке).

import catalog from '@/data/catalog.json'
import { listServices, type AppRouteService } from '@/lib/approute'
import { mockServices } from '@/lib/approute/mock'
import { mapServiceToCategorySlug, extractRegion } from '@/lib/approute/category-map'
import { listGames, type DesslyGame } from '@/lib/dessly'
import type { Product, Category, ProductType } from '@/types'

export interface CatalogCategory extends Category {
  usd_to_rub_rate: number
}

type RawCategory = (typeof catalog.categories)[number]

/**
 * Цена в рублях по формуле ТЗ: price_rub = ceil(price_usd × rate × (1 + markup%/100)).
 * Используем целочисленный множитель (100+markup)/100 вместо (1+markup/100), иначе ошибка
 * двоичного представления даёт +1: например 800×1.14 = 912.0000000000001 → ceil = 913,
 * тогда как по ТЗ должно быть ровно 912 (10$ ×80 +14%).
 */
export function priceRub(priceUsd: number, rate: number, markupPercent: number): number {
  return Math.ceil((priceUsd * rate * (100 + markupPercent)) / 100)
}

// Извлечение URL обложки из сырого объекта поставщика: берём первое валидное абсолютное
// http(s)-значение из распространённых имён полей. Имя поля в боевом API уточняется дампом
// (scripts/_dump_approute.mjs); устойчивость к синонимам нужна, чтобы не зависеть от его исхода.
const IMAGE_KEYS = [
  'imageUrl', 'image', 'imageURL', 'iconUrl', 'icon', 'logoUrl', 'logo',
  'coverUrl', 'cover', 'pictureUrl', 'picture', 'thumbnailUrl', 'thumbnail', 'imgUrl', 'img',
]
function pickImageUrl(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>
  for (const k of IMAGE_KEYS) {
    const v = rec[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim()
  }
  return undefined
}
/**
 * Обложка SKU: только честные данные от поставщика (номинал → сервис). Боевой AppRoute почти
 * никогда не отдаёт картинки (см. WORKLOG 2026-06-05) — раньше здесь был суррогатный фолбэк
 * (Steam header.jpg по appId / Google favicon по бренду), но синк безусловно перезаписывал им
 * image_url при КАЖДОМ прогоне, затирая как отсутствие картинки, так и уже настроенный
 * default_image_url категории. Теперь при отсутствии реальной картинки поле остаётся пустым,
 * и на чтении срабатывает фолбэк на category.default_image_url (см. /api/products).
 */
function serviceImage(svc: AppRouteService, den?: unknown): string | undefined {
  return pickImageUrl(den) ?? pickImageUrl(svc)
}

function catFromRaw(raw: RawCategory): CatalogCategory {
  return {
    id: raw.slug, // в фолбэк-режиме идентификатор категории = slug
    name: raw.name,
    slug: raw.slug,
    icon: raw.icon,
    markup_percent: raw.markup_percent,
    usd_to_rub_rate: raw.usd_to_rub_rate,
    supplier: raw.supplier as 'approute' | 'dessly',
    is_active: true,
    sort_order: raw.sort_order,
    regions: [],
  }
}

export function buildCategories(): CatalogCategory[] {
  return catalog.categories.map(catFromRaw).sort((a, b) => a.sort_order - b.sort_order)
}

function categoryBySlug(slug: string): CatalogCategory | undefined {
  return buildCategories().find((c) => c.slug === slug)
}

const NOW = new Date(0).toISOString() // детерминированная метка в фолбэк-режиме

function appRouteProducts(services: AppRouteService[]): Product[] {
  const products: Product[] = []
  for (const svc of services) {
    // Маппинг таксономии AppRoute → внутренний slug (быстрый путь в мок-режиме, ключевые слова — в боевом).
    const slug = mapServiceToCategorySlug(svc)
    const cat = slug ? categoryBySlug(slug) : undefined
    if (!cat) continue
    const isDtu = svc.type === 'direct_topup' || svc.type === 'dtu'
    const productType: ProductType = isDtu ? 'topup_auto' : 'instant'

    if (isDtu) {
      // Пополнение (авто): один товар на сервис, цена вводится пользователем.
      const minUsd = svc.minAmountUsd ?? 1
      const maxUsd = svc.maxAmountUsd ?? 500
      products.push({
        id: svc.id,
        name: svc.name,
        description: svc.description || '',
        type: productType,
        category_id: cat.id,
        category: { name: cat.name, slug: cat.slug },
        price: 0,
        stock: undefined,
        is_active: true,
        supplier: 'approute',
        supplier_id: svc.id,
        denomination_id: svc.items[0]?.id,
        min_amount: priceRub(minUsd, cat.usd_to_rub_rate, cat.markup_percent),
        max_amount: priceRub(maxUsd, cat.usd_to_rub_rate, cat.markup_percent),
        supplier_fields: svc.fields ?? null,
        image_url: serviceImage(svc),
        created_at: NOW,
        updated_at: NOW,
      })
      continue
    }

    // shop: отдельный товар на каждый номинал (denomination).
    // Если у сервиса заданы регионы (PSN: US/PL/DE/FR/TR/IN/UK) — разворачиваем
    // каждый номинал в отдельный SKU на каждый регион (уникальный denomination_id → нет дублей).
    const regions = svc.regions && svc.regions.length ? svc.regions : [null]
    for (const den of svc.items) {
      for (const region of regions) {
        const denomId = region ? `${den.id}_${region.toLowerCase()}` : den.id
        const nameSuffix = region ? ` (${region})` : ''
        // Боевой API отдаёт inStock числом (остаток), мок — boolean. Нормализуем к числу,
        // чтобы stock = реальный остаток, а is_active был корректным boolean (а не числом —
        // иначе в boolean-колонку БД через admin-роут синка пишется число). Зеркало логики
        // scripts/sync-approute.mjs.
        const stockNum = typeof den.inStock === 'number' ? den.inStock : den.inStock ? 100 : 0
        products.push({
          id: denomId,
          name: `${svc.name} — ${den.name}${nameSuffix}`,
          description: svc.description || '',
          type: productType,
          category_id: cat.id,
          category: { name: cat.name, slug: cat.slug },
          price: priceRub(den.price, cat.usd_to_rub_rate, cat.markup_percent),
          price_usd: den.price,
          stock: stockNum,
          is_active: stockNum > 0,
          supplier: 'approute',
          supplier_id: svc.id,
          denomination_id: denomId,
          image_url: serviceImage(svc, den),
          region: region || extractRegion(svc, den),
          created_at: NOW,
          updated_at: NOW,
        })
      }
    }
  }
  return products
}

function desslyProducts(games: DesslyGame[]): Product[] {
  const cat = categoryBySlug('dessly-games')
  if (!cat) return []
  return games.map((g) => ({
    id: g.id,
    name: g.name,
    description: `${g.platform} • отправка игры гифтом`,
    type: 'instant' as ProductType,
    category_id: cat.id,
    category: { name: cat.name, slug: cat.slug },
    price: priceRub(g.price, cat.usd_to_rub_rate, cat.markup_percent),
    stock: g.inStock ? 50 : 0,
    is_active: g.inStock,
    supplier: 'dessly' as const,
    supplier_id: g.id,
    denomination_id: g.id,
    created_at: NOW,
    updated_at: NOW,
  }))
}

function manualProducts(): Product[] {
  return catalog.manualProducts.map((m, i) => {
    const cat = categoryBySlug(m.categorySlug)
    const anyM = m as typeof m & { price_rub?: number }
    return {
      id: `manual-${i}-${m.categorySlug}`,
      name: m.name,
      description: m.description || '',
      type: m.type as ProductType,
      category_id: cat?.id || m.categorySlug,
      category: cat ? { name: cat.name, slug: cat.slug } : undefined,
      price: anyM.price_rub ?? 0,
      is_active: true,
      supplier: (cat?.supplier || 'approute') as 'approute' | 'dessly',
      created_at: NOW,
      updated_at: NOW,
    }
  })
}

// Кэш каталога (30 с) + один shared pending-промис, чтобы параллельные запросы не ждали каждый свой таймаут.
let _catalogCache: { products: Product[]; ts: number } | null = null
let _buildPromise: Promise<Product[]> | null = null
const CATALOG_TTL_MS = 30_000
const SERVICES_TIMEOUT_MS = 1500

/**
 * Полный нормализованный каталог из поставщиков (мок или боевой режим — прозрачно).
 * listServices() в live-режиме делает HTTP-запрос к AppRoute. Если он не отвечает за
 * SERVICES_TIMEOUT_MS — используем статичный каталог из catalog.json (тот же источник,
 * что и в мок-режиме). Это устраняет задержку 4–8 с при недоступном AppRoute API.
 * Параллельные вызовы разделяют один pending-промис — нет двойного ожидания.
 *
 * opts.live=true — для явных админских действий синка (кнопка «Синхронизировать AppRoute»,
 * /api/products/import): там задержка в несколько секунд приемлема, а тихая подмена боевых
 * данных моком из-за гонки с SERVICES_TIMEOUT_MS — нет. Поэтому ждём listServices() без
 * гонки с таймаутом (внутри у него свой APPROUTE_HTTP_TIMEOUT_MS, см. lib/approute/client.ts)
 * и не используем/не пишем 30-секундный кэш витрины.
 */
export async function buildCatalogProducts(opts?: { live?: boolean }): Promise<Product[]> {
  if (opts?.live) return _doBuildCatalog({ live: true })
  if (_catalogCache && Date.now() - _catalogCache.ts < CATALOG_TTL_MS) {
    return _catalogCache.products
  }
  if (_buildPromise) return _buildPromise
  _buildPromise = _doBuildCatalog().finally(() => { _buildPromise = null })
  return _buildPromise
}

async function _doBuildCatalog(opts?: { live?: boolean }): Promise<Product[]> {
  const staticServices = mockServices().items

  const [services, games] = await Promise.all([
    opts?.live
      ? listServices()
      : Promise.race([
          listServices(),
          new Promise<AppRouteService[]>((resolve) =>
            setTimeout(() => resolve(staticServices), SERVICES_TIMEOUT_MS)
          ),
        ]).catch(() => staticServices),
    listGames().catch(() => [] as DesslyGame[]),
  ])

  let sort = 0
  const all = [...appRouteProducts(services), ...desslyProducts(games), ...manualProducts()]
  const products = all.map((p) => ({ ...p, sort_order: sort++ } as Product & { sort_order: number }))
  if (!opts?.live) _catalogCache = { products, ts: Date.now() }
  return products
}

