'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function EditCategoryPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    icon: '',
    markup_percent: '14',
    usd_to_rub_rate: '80',
    supplier: '',
    is_active: true,
    sort_order: '0',
  })

  useEffect(() => {
    fetchCategory()
  }, [id])

  const fetchCategory = async () => {
    try {
      const res = await fetch('/api/admin/categories')
      const data = await res.json()
      const cat = (data.categories || []).find((c: { id: string }) => c.id === id)
      if (cat) {
        setFormData({
          name: cat.name ?? '',
          slug: cat.slug ?? '',
          icon: cat.icon ?? '',
          markup_percent: String(cat.markup_percent ?? 14),
          usd_to_rub_rate: String(cat.usd_to_rub_rate ?? 80),
          supplier: cat.supplier ?? '',
          is_active: cat.is_active ?? true,
          sort_order: String(cat.sort_order ?? 0),
        })
      }
    } catch (error) {
      console.error('Failed to fetch category:', error)
    } finally {
      setFetching(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
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
      }

      const res = await fetch(`/api/admin/categories/${id}`, {
        method: 'PATCH',
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
      console.error('Failed to update category:', error)
      alert('Ошибка при сохранении категории')
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return <div className="text-center py-12 text-muted">Загрузка...</div>
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Редактировать категорию</h1>
        <p className="text-muted">Изменение параметров категории</p>
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
                onChange={handleChange}
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
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">URL иконки</label>
              <input
                type="text"
                name="icon"
                value={formData.icon}
                onChange={handleChange}
                className="input"
                placeholder="https://..."
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

        {/* Ценообразование */}
        <div>
          <h3 className="text-[17px] font-bold text-navy mb-4">Ценообразование</h3>
          <p className="text-sm text-muted mb-4">
            При изменении наценки или курса цены всех товаров категории будут пересчитаны автоматически.
          </p>

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
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" onClick={() => router.back()} className="btn btn-ghost">
            Отмена
          </button>
        </div>
      </form>
    </div>
  )
}
