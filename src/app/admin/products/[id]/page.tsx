'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ProductType } from '@/types'

interface Category {
  id: string
  name: string
  slug: string
}

interface Product {
  id: string
  name: string
  description: string
  type: ProductType
  category_id: string
  price: number
  original_price?: number
  stock?: number
  is_active: boolean
  supplier: string
  supplier_service_id?: string
  denomination_id?: string
  min_amount?: number
  max_amount?: number
  image_url?: string
}

export default function EditProductPage() {
  const router = useRouter()
  const params = useParams()
  const productId = params.id as string

  const [categories, setCategories] = useState<Category[]>([])
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [keys, setKeys] = useState<any[]>([])
  const [newKeys, setNewKeys] = useState('')
  const [uploadingKeys, setUploadingKeys] = useState(false)

  useEffect(() => {
    fetchCategories()
    fetchProduct()
    fetchKeys()
  }, [productId])

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories')
      const data = await res.json()
      setCategories(data.categories || [])
    } catch (error) {
      console.error('Failed to fetch categories:', error)
    }
  }

  const fetchProduct = async () => {
    try {
      const res = await fetch(`/api/admin/products/${productId}`)
      const data = await res.json()
      setProduct(data.product)
    } catch (error) {
      console.error('Failed to fetch product:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchKeys = async () => {
    try {
      const res = await fetch(`/api/admin/products/${productId}/keys`)
      const data = await res.json()
      setKeys(data.keys || [])
    } catch (error) {
      console.error('Failed to fetch keys:', error)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    if (!product) return
    const { name, value, type } = e.target
    setProduct({
      ...product,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!product) return

    setSaving(true)

    try {
      const payload = {
        ...product,
        price: parseFloat(String(product.price)),
        original_price: product.original_price
          ? parseFloat(String(product.original_price))
          : null,
        stock: product.stock ? parseInt(String(product.stock)) : null,
        min_amount: product.min_amount ? parseFloat(String(product.min_amount)) : null,
        max_amount: product.max_amount ? parseFloat(String(product.max_amount)) : null,
      }

      const res = await fetch(`/api/admin/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        alert('Товар обновлён')
        router.push('/admin/products')
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to update product:', error)
      alert('Ошибка при обновлении товара')
    } finally {
      setSaving(false)
    }
  }

  const handleUploadKeys = async () => {
    if (!newKeys.trim()) {
      alert('Введите ключи')
      return
    }

    setUploadingKeys(true)

    try {
      const keysArray = newKeys
        .split('\n')
        .map((k) => k.trim())
        .filter((k) => k.length > 0)

      const res = await fetch(`/api/admin/products/${productId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keysArray }),
      })

      if (res.ok) {
        const data = await res.json()
        alert(`Загружено ключей: ${data.added}`)
        setNewKeys('')
        fetchKeys()
        fetchProduct()
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to upload keys:', error)
      alert('Ошибка при загрузке ключей')
    } finally {
      setUploadingKeys(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl">
        <div className="text-center py-12 text-muted">Загрузка...</div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="max-w-3xl">
        <div className="card card-pad text-center py-12 text-muted">
          Товар не найден
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">
          Редактировать товар
        </h1>
        <p className="text-muted">{product.name}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Основная информация */}
        <div className="card card-pad">
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
                value={product.name}
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
                value={product.description || ''}
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
                  value={product.type}
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
                  value={product.category_id || ''}
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
        <div className="card card-pad">
          <h3 className="text-[17px] font-bold text-navy mb-4">
            Цены и остатки
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Цена (₽) *
              </label>
              <input
                type="number"
                name="price"
                value={product.price}
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
                value={product.original_price || ''}
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
                value={product.stock || ''}
                onChange={handleChange}
                className="input"
                min="0"
                disabled={product.type === 'instant'}
              />
              {product.type === 'instant' && (
                <p className="text-xs text-muted-2 mt-1">
                  Обновляется автоматически при загрузке ключей
                </p>
              )}
            </div>

            <div className="flex items-center pt-8">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={product.is_active}
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

        {/* Кнопки сохранения */}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? 'Сохранение...' : 'Сохранить изменения'}
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

      {/* Загрузка ключей для instant товаров */}
      {product.type === 'instant' && (
        <div className="card card-pad mt-6">
          <h3 className="text-[17px] font-bold text-navy mb-4">
            Файловые ключи
          </h3>

          <div className="mb-4">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-sm font-semibold text-navy">
                Доступно ключей:
              </span>
              <span className="badge badge-stock">
                {keys.filter((k) => !k.is_used).length}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-navy">
                Использовано:
              </span>
              <span className="badge badge-out">
                {keys.filter((k) => k.is_used).length}
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Добавить ключи (по одному на строку)
              </label>
              <textarea
                value={newKeys}
                onChange={(e) => setNewKeys(e.target.value)}
                className="input min-h-[150px] font-mono text-sm"
                placeholder="KEY-1234-5678-ABCD&#10;KEY-9876-5432-WXYZ&#10;..."
                rows={6}
              />
            </div>

            <button
              type="button"
              onClick={handleUploadKeys}
              disabled={uploadingKeys || !newKeys.trim()}
              className="btn btn-primary"
            >
              {uploadingKeys ? 'Загрузка...' : 'Загрузить ключи'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
