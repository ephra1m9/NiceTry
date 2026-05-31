'use client'

import { useState, useEffect } from 'react'

interface PromoCode {
  id: string
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  max_uses?: number
  used_count: number
  expires_at?: string
  is_active: boolean
  created_at: string
}

export default function AdminPromoCodesPage() {
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    code: '',
    discount_type: 'percent' as 'percent' | 'fixed',
    discount_value: '',
    max_uses: '',
    expires_at: '',
    is_active: true,
  })

  useEffect(() => {
    fetchPromoCodes()
  }, [])

  const fetchPromoCodes = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/promo-codes')
      const data = await res.json()
      setPromoCodes(data.promo_codes || [])
    } catch (error) {
      console.error('Failed to fetch promo codes:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const payload = {
        code: formData.code.toUpperCase(),
        discount_type: formData.discount_type,
        discount_value: parseFloat(formData.discount_value),
        max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
        expires_at: formData.expires_at || null,
        is_active: formData.is_active,
      }

      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        alert('Промокод создан')
        setShowForm(false)
        setFormData({
          code: '',
          discount_type: 'percent',
          discount_value: '',
          max_uses: '',
          expires_at: '',
          is_active: true,
        })
        fetchPromoCodes()
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to create promo code:', error)
      alert('Ошибка при создании промокода')
    }
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })

      if (res.ok) {
        fetchPromoCodes()
      } else {
        alert('Ошибка при обновлении промокода')
      }
    } catch (error) {
      console.error('Failed to toggle promo code:', error)
      alert('Ошибка при обновлении промокода')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить промокод?')) return

    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        fetchPromoCodes()
      } else {
        alert('Ошибка при удалении промокода')
      }
    } catch (error) {
      console.error('Failed to delete promo code:', error)
      alert('Ошибка при удалении промокода')
    }
  }

  return (
    <div className="max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[30px] font-bold text-navy mb-2">Промокоды</h1>
          <p className="text-muted">Управление промокодами и скидками</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn btn-primary"
        >
          {showForm ? 'Отмена' : 'Создать промокод'}
        </button>
      </div>

      {/* Форма создания */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card card-pad mb-6">
          <h3 className="text-[17px] font-bold text-navy mb-4">
            Новый промокод
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Код промокода *
              </label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) =>
                  setFormData({ ...formData, code: e.target.value.toUpperCase() })
                }
                className="input"
                placeholder="SUMMER2024"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Тип скидки *
              </label>
              <select
                value={formData.discount_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    discount_type: e.target.value as 'percent' | 'fixed',
                  })
                }
                className="input"
                required
              >
                <option value="percent">Процент</option>
                <option value="fixed">Фиксированная сумма</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Значение скидки *
              </label>
              <input
                type="number"
                value={formData.discount_value}
                onChange={(e) =>
                  setFormData({ ...formData, discount_value: e.target.value })
                }
                className="input"
                step="0.01"
                min="0"
                placeholder={formData.discount_type === 'percent' ? '10' : '100'}
                required
              />
              <p className="text-xs text-muted-2 mt-1">
                {formData.discount_type === 'percent'
                  ? 'Процент скидки (0-100)'
                  : 'Сумма скидки в рублях'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Максимум использований
              </label>
              <input
                type="number"
                value={formData.max_uses}
                onChange={(e) =>
                  setFormData({ ...formData, max_uses: e.target.value })
                }
                className="input"
                min="1"
                placeholder="Без ограничений"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-navy mb-2">
                Срок действия
              </label>
              <input
                type="datetime-local"
                value={formData.expires_at}
                onChange={(e) =>
                  setFormData({ ...formData, expires_at: e.target.value })
                }
                className="input"
              />
            </div>

            <div className="flex items-center pt-8">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) =>
                    setFormData({ ...formData, is_active: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm font-semibold text-navy">
                  Промокод активен
                </span>
              </label>
            </div>
          </div>

          <div className="mt-6">
            <button type="submit" className="btn btn-primary">
              Создать промокод
            </button>
          </div>
        </form>
      )}

      {/* Список промокодов */}
      {loading ? (
        <div className="text-center py-12 text-muted">Загрузка...</div>
      ) : promoCodes.length === 0 ? (
        <div className="card card-pad text-center py-12 text-muted">
          Промокоды не найдены
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Код
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Скидка
                  </th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">
                    Использовано
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Срок действия
                  </th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">
                    Статус
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {promoCodes.map((promo) => (
                  <tr
                    key={promo.id}
                    className="border-b border-border hover:bg-gray-bg"
                  >
                    <td className="p-4">
                      <div className="font-mono font-semibold text-navy">
                        {promo.code}
                      </div>
                    </td>
                    <td className="p-4 text-muted">
                      {promo.discount_type === 'percent'
                        ? `${promo.discount_value}%`
                        : `${promo.discount_value} ₽`}
                    </td>
                    <td className="p-4 text-center text-muted">
                      {promo.used_count}
                      {promo.max_uses && ` / ${promo.max_uses}`}
                    </td>
                    <td className="p-4 text-muted">
                      {promo.expires_at
                        ? new Date(promo.expires_at).toLocaleDateString('ru-RU')
                        : 'Бессрочно'}
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`badge ${
                          promo.is_active ? 'badge-stock' : 'badge-out'
                        }`}
                      >
                        {promo.is_active ? 'Активен' : 'Неактивен'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() =>
                            handleToggleActive(promo.id, promo.is_active)
                          }
                          className="btn btn-sm btn-ghost"
                        >
                          {promo.is_active ? 'Деактивировать' : 'Активировать'}
                        </button>
                        <button
                          onClick={() => handleDelete(promo.id)}
                          className="btn btn-sm btn-ghost text-red hover:bg-red-bg"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
