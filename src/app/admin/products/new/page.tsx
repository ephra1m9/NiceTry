'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ProductType } from '@/types'

interface Category {
  id: string
  name: string
  slug: string
}

export default function NewProductPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'instant' as ProductType,
    category_id: '',
    price: '',
    original_price: '',
    stock: '',
    is_active: true,
    supplier: 'approute',
    supplier_service_id: '',
    denomination_id: '',
    min_amount: '',
    max_amount: '',
    image_url: '',
  })

  useEffect(() => {
    fetchCategories()
  }, [])

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories')
      const data = await res.json()
      setCategories(data.categories || [])
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
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
        ...formData,
        price: parseFloat(formData.price),
        original_price: formData.original_price
          ? parseFloat(formData.original_price)
          : null,
        stock: formData.stock ? parseInt(formData.stock) : null,
        min_amount: formData.min_amount ? parseFloat(formData.min_amount) : null,
        max_amount: formData.max_amount ? parseFloat(formData.max_amount) : null,
      }

      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        router.push('/admin/products')
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to create product:', error)
      alert('Ошибка при создании товара')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Создать товар</h1>
        <p className="text-muted">Добавление нового товара в каталог</p>
      </div>

      <form onSubmit={handleSubmit} className="card card-pad space-y-6">
        {/* Основная информация */}
        <div>
          <h3 className="text-[17px] font-bold text-navy mb-4">
            Основная информация
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Название *
              </label>
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
              <label className="block text-sm font-semibold text-navy mb-2">
                Описание
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                className="input min-h-[100px]"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Тип товара *
                </label>
                <select
                  name="type"
                  value={formData.type}
                  onChange={handleChange}
                  className="input"
                  required
                >
                  <option value="instant">Моментальный</option>
                  <option value="topup_auto">Пополнение (авто)</option>
                  <option value="topup_manual">Пополнение (ручное)</option>
                  <option value="manual">Ручная обработка</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Категория *
                </label>
                <select
                  name="category_id"
                  value={formData.category_id}
                  onChange={handleChange}
                  className="input"
                  required
                >
                  <option value="">Выберите категорию</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Цены и остатки */}
        <div>
          <h3 className="text-[17px] font-bold text-navy mb-4">Цены и остатки</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Цена (₽) *
              </label>
              <input
                type="number"
                name="price"
                value={formData.price}
                onChange={handleChange}
                className="input"
                step="0.01"
                min="0"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Старая цена (₽)
              </label>
              <input
                type="number"
                name="original_price"
                value={formData.original_price}
                onChange={handleChange}
                className="input"
                step="0.01"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Остаток (для instant)
              </label>
              <input
                type="number"
                name="stock"
                value={formData.stock}
                onChange={handleChange}
                className="input"
                min="0"
              />
            </div>

            <div className="flex items-center pt-8">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleChange}
                  className="w-4 h-4"
                />
                <span className="text-sm font-semibold text-navy">
                  Товар активен
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Поставщик */}
        <div>
          <h3 className="text-[17px] font-bold text-navy mb-4">
            Настройки поставщика
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Поставщик
              </label>
              <select
                name="supplier"
                value={formData.supplier}
                onChange={handleChange}
                className="input"
              >
                <option value="approute">AppRoute</option>
                <option value="dessly">Dessly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Service ID
              </label>
              <input
                type="text"
                name="supplier_service_id"
                value={formData.supplier_service_id}
                onChange={handleChange}
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Denomination ID
              </label>
              <input
                type="text"
                name="denomination_id"
                value={formData.denomination_id}
                onChange={handleChange}
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                URL изображения
              </label>
              <input
                type="text"
                name="image_url"
                value={formData.image_url}
                onChange={handleChange}
                className="input"
              />
            </div>
          </div>
        </div>

        {/* Лимиты для topup */}
        {(formData.type === 'topup_auto' || formData.type === 'topup_manual') && (
          <div>
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Лимиты пополнения
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Минимальная сумма (₽)
                </label>
                <input
                  type="number"
                  name="min_amount"
                  value={formData.min_amount}
                  onChange={handleChange}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Максимальная сумма (₽)
                </label>
                <input
                  type="number"
                  name="max_amount"
                  value={formData.max_amount}
                  onChange={handleChange}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div className="flex items-center gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? 'Создание...' : 'Создать товар'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="btn btn-ghost"
          >
            Отмена
          </button>
        </div>
      </form>
    </div>
  )
}
