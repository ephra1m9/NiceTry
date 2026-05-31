'use client'

import { useState } from 'react'
import Button from './ui/Button'
import Input from './ui/Input'
import Card from './ui/Card'

interface ProductFiltersProps {
  onFilterChange: (filters: FilterState) => void
  categories?: Array<{ id: string; name: string }>
}

export interface FilterState {
  search: string
  category_id: string
  type: string
  supplier: string
  min_price: string
  max_price: string
}

const PRODUCT_TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'instant', label: 'Моментальная выдача' },
  { value: 'topup_auto', label: 'Автопополнение' },
  { value: 'topup_manual', label: 'Ручное пополнение' },
  { value: 'manual', label: 'Ручная обработка' },
]

const SUPPLIERS = [
  { value: '', label: 'Все поставщики' },
  { value: 'approute', label: 'AppRoute' },
  { value: 'dessly', label: 'Dessly' },
]

export function ProductFilters({ onFilterChange, categories = [] }: ProductFiltersProps) {
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    category_id: '',
    type: '',
    supplier: '',
    min_price: '',
    max_price: '',
  })

  const [isExpanded, setIsExpanded] = useState(false)

  const handleChange = (key: keyof FilterState, value: string) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    onFilterChange(newFilters)
  }

  const handleReset = () => {
    const resetFilters: FilterState = {
      search: '',
      category_id: '',
      type: '',
      supplier: '',
      min_price: '',
      max_price: '',
    }
    setFilters(resetFilters)
    onFilterChange(resetFilters)
  }

  const hasActiveFilters = Object.values(filters).some((v) => v !== '')

  return (
    <Card className="mb-6">
      <div className="card-pad">
        {/* Поиск - всегда видим */}
        <div className="mb-4">
          <Input
            type="text"
            placeholder="Поиск товаров..."
            value={filters.search}
            onChange={(e) => handleChange('search', e.target.value)}
          />
        </div>

        {/* Кнопка раскрытия фильтров */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm text-blue font-semibold mb-3 hover:text-blue-600 transition-colors"
        >
          {isExpanded ? '▼ Скрыть фильтры' : '▶ Показать фильтры'}
        </button>

        {/* Расширенные фильтры */}
        {isExpanded && (
          <div className="space-y-4 pt-3 border-t border-border">
            {/* Категория */}
            {categories.length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Категория
                </label>
                <select
                  value={filters.category_id}
                  onChange={(e) => handleChange('category_id', e.target.value)}
                  className="input"
                >
                  <option value="">Все категории</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Тип товара */}
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Тип товара
              </label>
              <select
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

            {/* Поставщик */}
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Поставщик
              </label>
              <select
                value={filters.supplier}
                onChange={(e) => handleChange('supplier', e.target.value)}
                className="input"
              >
                {SUPPLIERS.map((supplier) => (
                  <option key={supplier.value} value={supplier.value}>
                    {supplier.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Диапазон цен */}
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Цена
              </label>
              <div className="flex gap-3">
                <Input
                  type="number"
                  placeholder="От"
                  value={filters.min_price}
                  onChange={(e) => handleChange('min_price', e.target.value)}
                  min="0"
                />
                <Input
                  type="number"
                  placeholder="До"
                  value={filters.max_price}
                  onChange={(e) => handleChange('max_price', e.target.value)}
                  min="0"
                />
              </div>
            </div>

            {/* Кнопка сброса */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="w-full"
              >
                Сбросить фильтры
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
