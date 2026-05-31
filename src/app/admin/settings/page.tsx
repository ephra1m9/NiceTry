'use client'

import { useState, useEffect } from 'react'

interface UserStatus {
  id: string
  name: string
  discount_percent: number
  min_spent: number
  sort_order: number
}

export default function AdminSettingsPage() {
  const [statuses, setStatuses] = useState<UserStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<UserStatus>>({})

  useEffect(() => {
    fetchStatuses()
  }, [])

  const fetchStatuses = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/settings/statuses')
      const data = await res.json()
      setStatuses(data.statuses || [])
    } catch (error) {
      console.error('Failed to fetch statuses:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (status: UserStatus) => {
    setEditingId(status.id)
    setEditData(status)
  }

  const handleSave = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/settings/statuses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })

      if (res.ok) {
        setEditingId(null)
        fetchStatuses()
      } else {
        alert('Ошибка при обновлении статуса')
      }
    } catch (error) {
      console.error('Failed to update status:', error)
      alert('Ошибка при обновлении статуса')
    }
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditData({})
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Настройки</h1>
        <p className="text-muted">Управление системными параметрами</p>
      </div>

      {/* Статусы пользователей */}
      <div className="card mb-6">
        <div className="p-6 border-b border-border">
          <h2 className="text-[17px] font-bold text-navy">
            Статусы пользователей
          </h2>
          <p className="text-sm text-muted mt-1">
            Настройка уровней и скидок для пользователей
          </p>
        </div>

        {loading ? (
          <div className="p-6 text-center text-muted">Загрузка...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Название
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Скидка (%)
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Мин. потрачено (₽)
                  </th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">
                    Порядок
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((status) => (
                  <tr
                    key={status.id}
                    className="border-b border-border hover:bg-gray-bg"
                  >
                    {editingId === status.id ? (
                      <>
                        <td className="p-4">
                          <input
                            type="text"
                            value={editData.name || ''}
                            onChange={(e) =>
                              setEditData({ ...editData, name: e.target.value })
                            }
                            className="input"
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            value={editData.discount_percent || 0}
                            onChange={(e) =>
                              setEditData({
                                ...editData,
                                discount_percent: parseFloat(e.target.value),
                              })
                            }
                            className="input text-right"
                            step="0.01"
                            min="0"
                            max="100"
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            value={editData.min_spent || 0}
                            onChange={(e) =>
                              setEditData({
                                ...editData,
                                min_spent: parseFloat(e.target.value),
                              })
                            }
                            className="input text-right"
                            step="0.01"
                            min="0"
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            value={editData.sort_order || 0}
                            onChange={(e) =>
                              setEditData({
                                ...editData,
                                sort_order: parseInt(e.target.value),
                              })
                            }
                            className="input text-center"
                            min="0"
                          />
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleSave(status.id)}
                              className="btn btn-sm btn-primary"
                            >
                              Сохранить
                            </button>
                            <button
                              onClick={handleCancel}
                              className="btn btn-sm btn-ghost"
                            >
                              Отмена
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-4">
                          <div className="font-semibold text-navy">
                            {status.name}
                          </div>
                        </td>
                        <td className="p-4 text-right text-muted">
                          {status.discount_percent}%
                        </td>
                        <td className="p-4 text-right text-muted">
                          {status.min_spent.toFixed(2)} ₽
                        </td>
                        <td className="p-4 text-center text-muted">
                          {status.sort_order}
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleEdit(status)}
                            className="btn btn-sm btn-ghost"
                          >
                            Редактировать
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Общие настройки */}
      <div className="card card-pad">
        <h2 className="text-[17px] font-bold text-navy mb-4">
          Общие настройки
        </h2>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-navy mb-2">
              Наценка по умолчанию (%)
            </label>
            <input
              type="number"
              defaultValue="14"
              className="input max-w-xs"
              step="0.01"
              min="0"
              disabled
            />
            <p className="text-xs text-muted-2 mt-1">
              Применяется к товарам из внешних API
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-navy mb-2">
              Курс USD → ₽
            </label>
            <input
              type="number"
              defaultValue="80"
              className="input max-w-xs"
              step="0.01"
              min="0"
              disabled
            />
            <p className="text-xs text-muted-2 mt-1">
              Используется для конвертации цен AppRoute
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-navy mb-2">
              Реферальный процент (%)
            </label>
            <input
              type="number"
              defaultValue="5"
              className="input max-w-xs"
              step="0.01"
              min="0"
              max="100"
              disabled
            />
            <p className="text-xs text-muted-2 mt-1">
              Процент от покупок рефералов
            </p>
          </div>

          <div className="pt-4 border-t border-border">
            <p className="text-sm text-muted-2">
              Редактирование общих настроек будет доступно в следующей версии.
              Сейчас значения задаются в коде и базе данных.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
