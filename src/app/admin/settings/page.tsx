'use client'

import { useState, useEffect } from 'react'

interface UserStatus {
  id: string
  name: string
  discount_percent: number
  min_spent: number
  sort_order: number
}

interface PopularGame {
  app_id: number
  name: string
}

interface ProxySettings {
  markup_percent: number
  usd_to_rub_rate: number
  is_enabled: boolean
  allowed_periods: number[]
  max_count: number
}

export default function AdminSettingsPage() {
  const [statuses, setStatuses] = useState<UserStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<UserStatus>>({})

  // Популярные игры: порядок выдачи в /send-game (сортировка sort=popularity).
  const [popular, setPopular] = useState<PopularGame[]>([])
  const [popularLoading, setPopularLoading] = useState(true)
  const [popularSaving, setPopularSaving] = useState(false)
  const [popularMsg, setPopularMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [newGameId, setNewGameId] = useState('')
  const [newGameName, setNewGameName] = useState('')

  // Прокси px6: наценка/курс/лимиты/вкл-выкл блока покупки (синглтон proxy_settings).
  const [proxy, setProxy] = useState<ProxySettings | null>(null)
  const [proxyPeriodsText, setProxyPeriodsText] = useState('')
  const [proxySaving, setProxySaving] = useState(false)
  const [proxyMsg, setProxyMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    fetchStatuses()
    fetchPopular()
    fetchProxy()
  }, [])

  const fetchProxy = async () => {
    try {
      const res = await fetch('/api/admin/proxy-settings', { cache: 'no-store' })
      const data = await res.json()
      if (data.settings) {
        setProxy(data.settings)
        setProxyPeriodsText((data.settings.allowed_periods || []).join(', '))
      }
    } catch (error) {
      console.error('Failed to fetch proxy settings:', error)
    }
  }

  const saveProxy = async () => {
    if (!proxy) return
    setProxySaving(true)
    setProxyMsg(null)
    try {
      const res = await fetch('/api/admin/proxy-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markup_percent: proxy.markup_percent,
          usd_to_rub_rate: proxy.usd_to_rub_rate,
          is_enabled: proxy.is_enabled,
          max_count: proxy.max_count,
          allowed_periods: proxyPeriodsText,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProxyMsg({ type: 'err', text: body.error || 'Не удалось сохранить' })
        return
      }
      setProxy(body.settings)
      setProxyPeriodsText((body.settings.allowed_periods || []).join(', '))
      setProxyMsg({ type: 'ok', text: 'Настройки прокси сохранены' })
    } catch (error) {
      setProxyMsg({ type: 'err', text: 'Ошибка сети при сохранении' })
    } finally {
      setProxySaving(false)
    }
  }

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

  const fetchPopular = async () => {
    try {
      setPopularLoading(true)
      const res = await fetch('/api/admin/popular-games')
      const data = await res.json()
      setPopular(Array.isArray(data.popular) ? data.popular : [])
    } catch (error) {
      console.error('Failed to fetch popular games:', error)
    } finally {
      setPopularLoading(false)
    }
  }

  const savePopular = async (next: PopularGame[]) => {
    setPopularSaving(true)
    setPopularMsg(null)
    try {
      const res = await fetch('/api/admin/popular-games', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ popular: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPopularMsg({ type: 'err', text: body.error || 'Не удалось сохранить' })
        return false
      }
      setPopular(next)
      setPopularMsg({ type: 'ok', text: `Сохранено: ${next.length} игр` })
      return true
    } catch (error) {
      setPopularMsg({ type: 'err', text: 'Ошибка сети при сохранении' })
      return false
    } finally {
      setPopularSaving(false)
    }
  }

  const movePopular = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= popular.length) return
    const next = [...popular]
    ;[next[index], next[target]] = [next[target], next[index]]
    savePopular(next)
  }

  const removePopular = (index: number) => {
    savePopular(popular.filter((_, i) => i !== index))
  }

  const addPopular = () => {
    const appId = parseInt(newGameId.trim(), 10)
    const name = newGameName.trim()
    if (!appId || Number.isNaN(appId) || !name) {
      setPopularMsg({ type: 'err', text: 'Укажите числовой app_id и название' })
      return
    }
    if (popular.some((g) => g.app_id === appId)) {
      setPopularMsg({ type: 'err', text: `app_id ${appId} уже в списке` })
      return
    }
    savePopular([...popular, { app_id: appId, name }]).then((ok) => {
      if (ok) {
        setNewGameId('')
        setNewGameName('')
      }
    })
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

      {/* Прокси px6: наценка / курс / лимиты / вкл-выкл блока покупки */}
      <div className="card mb-6">
        <div className="p-6 border-b border-border">
          <h2 className="text-[17px] font-bold text-navy">Прокси (px6)</h2>
          <p className="text-sm text-muted mt-1">
            Наценка, курс и лимиты блока «Купить прокси» на главной. Цена считается как
            ceil(цена_px6_в_₽ × (1 + наценка%/100)).
          </p>
        </div>

        <div className="p-6">
          {proxyMsg && (
            <div className={`alert mb-4 ${proxyMsg.type === 'ok' ? 'alert-success' : 'alert-error'}`}>
              <span>{proxyMsg.text}</span>
            </div>
          )}

          {!proxy ? (
            <div className="loading-block">
              <div className="spinner" />
              <span>Загрузка настроек...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <label className="flex items-center gap-3 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={proxy.is_enabled}
                  onChange={(e) => setProxy({ ...proxy, is_enabled: e.target.checked })}
                />
                <span className="font-semibold text-navy">Покупка прокси включена</span>
                <span className="text-sm text-muted">(выключение скрывает блок на главной)</span>
              </label>

              <div>
                <label className="label">Наценка (%)</label>
                <input
                  type="number"
                  value={proxy.markup_percent}
                  onChange={(e) => setProxy({ ...proxy, markup_percent: parseFloat(e.target.value) })}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="label">Курс USD→₽ (если px6 в USD)</label>
                <input
                  type="number"
                  value={proxy.usd_to_rub_rate}
                  onChange={(e) => setProxy({ ...proxy, usd_to_rub_rate: parseFloat(e.target.value) })}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="label">Макс. кол-во за покупку</label>
                <input
                  type="number"
                  value={proxy.max_count}
                  onChange={(e) => setProxy({ ...proxy, max_count: parseInt(e.target.value, 10) })}
                  className="input"
                  min="1"
                />
              </div>

              <div>
                <label className="label">Доступные сроки (дней, через запятую)</label>
                <input
                  type="text"
                  value={proxyPeriodsText}
                  onChange={(e) => setProxyPeriodsText(e.target.value)}
                  className="input"
                  placeholder="7, 14, 30, 90"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  onClick={saveProxy}
                  disabled={proxySaving}
                  className="btn btn-primary"
                  data-loading={proxySaving ? 'true' : undefined}
                >
                  Сохранить настройки прокси
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Популярные игры: порядок выдачи в /send-game */}
      <div className="card mb-6">
        <div className="p-6 border-b border-border">
          <h2 className="text-[17px] font-bold text-navy">Популярные игры (Steam top)</h2>
          <p className="text-sm text-muted mt-1">
            Порядок популярных тайтлов в «Отправь игру» (выше в списке = популярнее). Эти игры
            показываются первыми, остальные — по алфавиту.
          </p>
        </div>

        <div className="p-6">
          {popularMsg && (
            <div className={`alert mb-4 ${popularMsg.type === 'ok' ? 'alert-success' : 'alert-error'}`}>
              <span>{popularMsg.text}</span>
            </div>
          )}

          {/* Добавление новой игры */}
          <div className="flex flex-wrap items-end gap-3 mb-5">
            <div className="flex-none w-32">
              <label className="label">app_id</label>
              <input
                type="number"
                value={newGameId}
                onChange={(e) => setNewGameId(e.target.value)}
                className="input"
                placeholder="730"
                min="1"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label">Название</label>
              <input
                type="text"
                value={newGameName}
                onChange={(e) => setNewGameName(e.target.value)}
                className="input"
                placeholder="Counter-Strike 2"
              />
            </div>
            <button
              onClick={addPopular}
              disabled={popularSaving}
              className="btn btn-primary"
              data-loading={popularSaving ? 'true' : undefined}
            >
              Добавить
            </button>
          </div>

          {popularLoading ? (
            <div className="loading-block">
              <div className="spinner" />
              <span>Загрузка списка...</span>
            </div>
          ) : popular.length === 0 ? (
            <div className="empty-state">
              <p>Список пуст. Добавьте популярные тайтлы выше.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-bg border-b border-border">
                  <tr>
                    <th className="text-left p-3 text-sm font-semibold text-navy w-16">#</th>
                    <th className="text-left p-3 text-sm font-semibold text-navy">Название</th>
                    <th className="text-left p-3 text-sm font-semibold text-navy w-28">app_id</th>
                    <th className="text-right p-3 text-sm font-semibold text-navy w-44">Порядок</th>
                  </tr>
                </thead>
                <tbody>
                  {popular.map((game, i) => (
                    <tr key={game.app_id} className="border-b border-border hover:bg-gray-bg">
                      <td className="p-3 text-muted-2 font-semibold">{i + 1}</td>
                      <td className="p-3 font-semibold text-navy">{game.name}</td>
                      <td className="p-3 text-muted">{game.app_id}</td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => movePopular(i, -1)}
                            disabled={i === 0 || popularSaving}
                            className="btn btn-sm btn-ghost"
                            title="Выше"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => movePopular(i, 1)}
                            disabled={i === popular.length - 1 || popularSaving}
                            className="btn btn-sm btn-ghost"
                            title="Ниже"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removePopular(i)}
                            disabled={popularSaving}
                            className="btn btn-sm btn-danger"
                            title="Удалить"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
