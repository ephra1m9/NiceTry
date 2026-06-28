'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import REGIONS_LIST from '@/data/regions.json'
import { ImageUploadField } from '@/components/admin/ImageUploadField'

export default function NewCategoryPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    icon: '',
    markup_percent: '14',
    usd_to_rub_rate: '80',
    supplier: '',
    is_active: true,
    sort_order: '0',
    regions: [] as string[],
  })

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }))
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    const autoSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    setFormData((prev) => ({
      ...prev,
      name,
      slug: prev.slug === '' || prev.slug === autoSlug.slice(0, -1) ? autoSlug : prev.slug,
    }))
  }

  const handleRegionToggle = (code: string) => {
    setFormData((prev) => ({
      ...prev,
      regions: prev.regions.includes(code)
        ? prev.regions.filter((r) => r !== code)
        : [...prev.regions, code],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const payload = {
        name: formData.name,
        slug: formData.slug || undefined,
        icon: formData.icon || undefined,
        markup_percent: parseFloat(formData.markup_percent),
        usd_to_rub_rate: parseFloat(formData.usd_to_rub_rate),
        supplier: formData.supplier || undefined,
        is_active: formData.is_active,
        sort_order: parseInt(formData.sort_order),
        regions: formData.regions,
      }

      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        router.push('/admin/categories')
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to create category:', error)
      alert('Ошибка при создании категории')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Создать категорию</h1>
        <p className="text-muted">Добавление новой категории в каталог</p>
      </div>

      <form onSubmit={handleSubmit} className="card card-pad space-y-6">
        {/* Основная информация */}
        <div>
          <h3 className="text-[17px] font-bold text-navy mb-4">Основная информация</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">Название *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleNameChange}
                className="input"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">Slug</label>
              <input
                type="text"
                name="slug"
                value={formData.slug}
                onChange={handleChange}
                className="input font-mono"
                placeholder="auto-generated-from-name"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">Иконка</label>
              <ImageUploadField
                value={formData.icon}
                onChange={(url) => setFormData((prev) => ({ ...prev, icon: url }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-navy mb-2">Поставщик</label>
                <select
                  name="supplier"
                  value={formData.supplier}
                  onChange={handleChange}
                  className="input"
                >
                  <option value="">Не задан</option>
                  <option value="approute">AppRoute</option>
                  <option value="dessly">Dessly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-navy mb-2">Порядок сортировки</label>
                <input
                  type="number"
                  name="sort_order"
                  value={formData.sort_order}
                  onChange={handleChange}
                  className="input"
                  min="0"
                />
              </div>
            </div>

            <div className="flex items-center pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleChange}
                  className="w-4 h-4"
                />
                <span className="text-sm font-semibold text-navy">Категория активна</span>
              </label>
            </div>
          </div>
        </div>

        {/* Регионы */}
        <div>
          <h3 className="text-[17px] font-bold text-navy mb-1">Регионы</h3>
          <p className="text-sm text-muted mb-4">Выберите регионы, доступные в этой категории. Используются для фильтрации товаров на странице категории.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {REGIONS_LIST.map((region) => (
              <label key={region.code} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.regions.includes(region.code)}
                  onChange={() => handleRegionToggle(region.code)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-navy">
                  <span className="font-mono text-muted text-xs mr-1">{region.code}</span>
                  {region.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Ценообразование */}
        <div>
          <h3 className="text-[17px] font-bold text-navy mb-4">Ценообразование</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">Наценка (%)</label>
              <input
                type="number"
                name="markup_percent"
                value={formData.markup_percent}
                onChange={handleChange}
                className="input"
                step="0.01"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">Курс USD → RUB</label>
              <input
                type="number"
                name="usd_to_rub_rate"
                value={formData.usd_to_rub_rate}
                onChange={handleChange}
                className="input"
                step="0.01"
                min="0"
              />
            </div>
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex items-center gap-3 pt-4">
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? 'Создание...' : 'Создать категорию'}
          </button>
          <button type="button" onClick={() => router.back()} className="btn btn-ghost">
            Отмена
          </button>
        </div>
      </form>
    </div>
  )
}
