// Маппинг таксономии AppRoute → внутренние категории NiceTry.
//
// Зачем: в боевом режиме AppRoute отдаёт собственные названия категорий/секций, которые
// не совпадают со slug'ами NiceTry. Этот модуль приводит сервис поставщика к нашему slug
// по ключевым словам (categoryName / subcategoryName / section / name) и извлекает регион
// (для PSN: US/PL/DE/FR/TR/IN/UK). В мок-режиме categoryName уже равен slug — тогда он
// проходит напрямую (быстрый путь).
//
// Таблица ключевых слов вынесена в src/data/approute-category-map.json, чтобы её разделял
// и скрипт scripts/sync-approute.mjs.

import map from '@/data/approute-category-map.json'
import type { AppRouteService, AppRouteDenomination } from './types'

/** Регионы PSN, поддерживаемые на старте (строго по ТЗ/задаче). */
export const PSN_REGIONS: readonly string[] = map.psnRegions

/** Все коды регионов, встречающиеся в фильтрах любой категории (PSN/Steam/Roblox/AppStore и т.д.) —
 * используется normalizeRegion/extractRegion, чтобы регион извлекался не только для PSN. */
export const SUPPORTED_REGIONS: readonly string[] = map.regionCodes

/** Внутренние slug'и категорий, которые мы импортируем из AppRoute. */
export const REQUIRED_CATEGORY_SLUGS: readonly string[] = map.categories.map((c) => c.slug)

const KNOWN_SLUGS = new Set(REQUIRED_CATEGORY_SLUGS)

function haystack(svc: Pick<AppRouteService, 'name' | 'categoryName' | 'subcategoryName' | 'section'>): string {
  return [svc.categoryName, svc.subcategoryName, svc.section, svc.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * Определяет внутренний slug категории для сервиса AppRoute.
 * Возвращает null, если сервис не относится ни к одной из нужных категорий (тогда импортёр его пропускает).
 */
export function mapServiceToCategorySlug(
  svc: Pick<AppRouteService, 'name' | 'categoryName' | 'subcategoryName' | 'section'>
): string | null {
  // Быстрый путь: categoryName уже является нашим slug (мок-режим / уже смаппленные данные).
  if (svc.categoryName && KNOWN_SLUGS.has(svc.categoryName)) return svc.categoryName

  const hay = haystack(svc)
  if (!hay.trim()) return null
  for (const entry of map.categories) {
    if (entry.keywords.some((kw) => hay.includes(kw.toLowerCase()))) return entry.slug
  }
  return null
}

/**
 * Нормализует строку региона к коду из SUPPORTED_REGIONS (объединение регионов всех категорий —
 * PSN/Steam/Roblox/AppStore и т.д., см. approute-category-map.json). Понимает алиасы (GB→UK,
 * USA→US, «United Kingdom»→UK и т.п.). Возвращает null, если регион не входит в поддерживаемый набор.
 */
export function normalizeRegion(raw: string | undefined | null): string | null {
  if (!raw) return null
  const up = raw.trim().toUpperCase()
  if (!up) return null
  if (SUPPORTED_REGIONS.includes(up)) return up
  const alias = (map.regionAliases as Record<string, string>)[up]
  if (alias && SUPPORTED_REGIONS.includes(alias)) return alias
  return null
}

/**
 * Извлекает код региона из сервиса/номинала AppRoute: сначала из явного поля (countryCode/region),
 * затем из текста названия (например "PSN $10 (TR)"). Возвращает null, если регион не определён.
 */
export function extractRegion(
  svc: Pick<AppRouteService, 'countryCode' | 'name'>,
  den?: Pick<AppRouteDenomination, 'region' | 'name'>
): string | null {
  const candidates = [den?.region, svc.countryCode, den?.name, svc.name]
  for (const c of candidates) {
    const direct = normalizeRegion(c)
    if (direct) return direct
    // Поиск кода региона в скобках/словах текста: "(TR)", "TR region" и т.п.
    if (c) {
      const m = c.toUpperCase().match(/\b([A-Z]{2,})\b/g)
      for (const token of m ?? []) {
        const norm = normalizeRegion(token)
        if (norm) return norm
      }
    }
  }
  return null
}
