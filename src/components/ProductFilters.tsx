'use client'

import { useState } from 'react'
import Button from './ui/Button'
import Input from './ui/Input'
import Card from './ui/Card'
import { formatProductTitle } from '@/lib/utils'

interface ProductFiltersProps {
  onFilterChange: (filters: FilterState) => void
  categories?: Array<{ id: string; name: string }>
  /** Раскрыть расширенные фильтры по умолчанию */
  defaultExpanded?: boolean
  /** Начальные значения (например, поисковый запрос из URL) */
  initial?: Partial<FilterState>
}

export interface FilterState {
  search: string
  category_id: string
  type: string
  min_price: string
  max_price: string
  region: string
  sort: string
}

const EMPTY: FilterState = {
  search: '',
  category_id: '',
  type: '',
  min_price: '',
  max_price: '',
  region: '',
  sort: '',
}

const PRODUCT_TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'instant', label: 'Моментальная выдача' },
  { value: 'topup_auto', label: 'Автопополнение' },
  { value: 'topup_manual', label: 'Ручное пополнение' },
  { value: 'manual', label: 'Ручная обработка' },
]

const SORT_OPTIONS = [
  { value: '', label: 'По умолчанию' },
  { value: 'price_asc', label: 'Цена: сначала дешёвые' },
  { value: 'price_desc', label: 'Цена: сначала дорогие' },
  { value: 'name_asc', label: 'Название: А-Я' },
  { value: 'name_desc', label: 'Название: Я-А' },
  { value: 'new', label: 'Сначала новые' },
]


export function ProductFilters({ onFilterChange, categories = [], defaultExpanded = false, initial }: ProductFiltersProps) {
  const [filters, setFilters] = useState<FilterState>({ ...EMPTY, ...initial })
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const handleChange = (key: keyof FilterState, value: string) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    onFilterChange(newFilters)
  }

  const handleReset = () => {
    setFilters(EMPTY)
    onFilterChange(EMPTY)
  }

  const hasActiveFilters = Object.values(filters).some((v) => v !== '')

  return (
    <Card className="lg:sticky lg:top-24" padding={false}>
      <div className="card-pad">
        {/* Поиск — всегда виден */}
        <div className="relative mb-3">
          <svg className="ic absolute left-3 top-1/2 -translate-y-1/2 text-muted-2 pointer-events-none" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.2-3.2" />
          </svg>
          <Input
            type="search"
            aria-label="Поиск товаров"
            placeholder="Поиск товаров…"
            className="pl-10"
            value={filters.search}
            onChange={(e) => handleChange('search', e.target.value)}
          />
        </div>

        {/* Сортировка — всегда видна */}
        <div className="mb-3">
          <label className="label" htmlFor="f-sort">Сортировка</label>
          <select
            id="f-sort"
            value={filters.sort}
            onChange={(e) => handleChange('sort', e.target.value)}
            className="input"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Фильтр по цене — всегда виден */}
        <div className="mt-3">
          <label className="label">Цена, ₽</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              aria-label="Цена от"
              placeholder="от"
              value={filters.min_price}
              onChange={(e) => handleChange('min_price', e.target.value)}
              min="0"
            />
            <span className="text-muted-2">—</span>
            <Input
              type="number"
              aria-label="Цена до"
              placeholder="до"
              value={filters.max_price}
              onChange={(e) => handleChange('max_price', e.target.value)}
              min="0"
            />
          </div>
        </div>

        {/* Кнопка раскрытия дополнительных фильтров */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          className="flex items-center justify-between w-full text-sm text-blue-700 font-semibold py-1.5 mt-3 hover:text-blue transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <svg className="ic ic-sm" viewBox="0 0 24 24">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Ещё фильтры
            {hasActiveFilters && (
              <span className="badge badge-instant !h-5 !px-1.5 !text-[10.5px]">активны</span>
            )}
          </span>
          <svg
            className={`ic ic-sm transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Дополнительные фильтры */}
        {isExpanded && (
          <div className="space-y-4 pt-4 mt-2 border-t border-border">
            {categories.length > 0 && (
              <div>
                <label className="label" htmlFor="f-cat">Категория</label>
                <select
                  id="f-cat"
                  value={filters.category_id}
                  onChange={(e) => handleChange('category_id', e.target.value)}
                  className="input"
                >
                  <option value="">Все категории</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {formatProductTitle(cat.name)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="label" htmlFor="f-type">Тип товара</label>
              <select
                id="f-type"
                value={filters.type}
                onChange={(e) => handleChange('type', e.target.value)}
                className="input"
              >
                {PRODUCT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleReset} block className="mt-3">
            Сбросить фильтры
          </Button>
        )}
      </div>
    </Card>
  )
}
