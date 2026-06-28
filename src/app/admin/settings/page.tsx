'use client'

import { useState, useEffect } from 'react'
import { ImageUploadField } from '@/components/admin/ImageUploadField'

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

interface TelegramSettings {
  markup_percent: number
  usd_to_rub_rate: number
}

interface EsimSettings {
  markup_percent: number
  usd_to_rub_rate: number
  is_enabled: boolean
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

  // Telegram Stars/Premium: наценка/курс (синглтон telegram_settings).
  const [telegram, setTelegram] = useState<TelegramSettings | null>(null)
  const [telegramSaving, setTelegramSaving] = useState(false)
  const [telegramMsg, setTelegramMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // eSIM: наценка/курс/вкл-выкл витрины (синглтон esim_settings).
  const [esim, setEsim] = useState<EsimSettings | null>(null)
  const [esimSaving, setEsimSaving] = useState(false)
  const [esimMsg, setEsimMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Поиск по каталогу AppRoute (для нахождения approute_service_id).
  const [dtuSearch, setDtuSearch] = useState('')
  const [dtuResults, setDtuResults] = useState<Array<{ id: string; name: string; type: string|null; hasDtuFields: boolean; section: string|null; denominationsCount: number; fields: string[] }>>([])
  const [dtuLoading, setDtuLoading] = useState(false)
  const [dtuError, setDtuError] = useState('')

  // Игровые пополнения: per-game наценка/курс/изображение (таблица game_topup_games).
  const [gameTopupGames, setGameTopupGames] = useState<Array<{
    id: string; slug: string; name: string; image_url: string | null
    approute_service_id: string | null; approute_service_ids: Record<string,string>|null
    markup_percent: number; usd_to_rub_rate: number; is_active: boolean; sort_order: number
  }>>([])
  const [gameTopupLoading, setGameTopupLoading] = useState(true)
  const [gameTopupSyncing, setGameTopupSyncing] = useState(false)
  const [gameTopupMsg, setGameTopupMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [editingGameId, setEditingGameId] = useState<string | null>(null)
  const [editGameData, setEditGameData] = useState<Record<string, string | number | boolean | null>>({})
  const [gameSaving, setGameSaving] = useState(false)

  // Форма создания новой игры.
  const EMPTY_NEW_GAME = { name: '', slug: '', markup_percent: 20, usd_to_rub_rate: 85, image_url: '', approute_service_id: '', approute_service_ids: '', account_fields: '[]', is_active: true }
  const [showNewGame, setShowNewGame] = useState(false)
  const [newGame, setNewGame] = useState({ ...EMPTY_NEW_GAME })
  const [newGameSaving, setNewGameSaving] = useState(false)
  const [newGameErr, setNewGameErr] = useState('')

  useEffect(() => {
    fetchStatuses()
    fetchPopular()
    fetchProxy()
    fetchTelegram()
    fetchEsim()
    fetchGameTopupGames()
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

  const fetchTelegram = async () => {
    try {
      const res = await fetch('/api/admin/telegram-settings', { cache: 'no-store' })
      const data = await res.json()
      if (data.settings) {
        setTelegram(data.settings)
      }
    } catch (error) {
      console.error('Failed to fetch telegram settings:', error)
    }
  }

  const saveTelegram = async () => {
    if (!telegram) return
    setTelegramSaving(true)
    setTelegramMsg(null)
    try {
      const res = await fetch('/api/admin/telegram-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markup_percent: telegram.markup_percent,
          usd_to_rub_rate: telegram.usd_to_rub_rate,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTelegramMsg({ type: 'err', text: body.error || 'Не удалось сохранить' })
        return
      }
      setTelegram(body.settings)
      setTelegramMsg({ type: 'ok', text: 'Настройки Telegram сохранены' })
    } catch (error) {
      setTelegramMsg({ type: 'err', text: 'Ошибка сети при сохранении' })
    } finally {
      setTelegramSaving(false)
    }
  }

  const fetchEsim = async () => {
    try {
      const res = await fetch('/api/admin/esim-settings', { cache: 'no-store' })
      const data = await res.json()
      if (data.settings) {
        setEsim(data.settings)
      }
    } catch (error) {
      console.error('Failed to fetch esim settings:', error)
    }
  }

  const saveEsim = async () => {
    if (!esim) return
    setEsimSaving(true)
    setEsimMsg(null)
    try {
      const res = await fetch('/api/admin/esim-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markup_percent: esim.markup_percent,
          usd_to_rub_rate: esim.usd_to_rub_rate,
          is_enabled: esim.is_enabled,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEsimMsg({ type: 'err', text: body.error || 'Не удалось сохранить' })
        return
      }
      setEsim(body.settings)
      setEsimMsg({ type: 'ok', text: 'Настройки eSIM сохранены' })
    } catch (error) {
      setEsimMsg({ type: 'err', text: 'Ошибка сети при сохранении' })
    } finally {
      setEsimSaving(false)
    }
  }

  const fetchGameTopupGames = async () => {
    try {
      setGameTopupLoading(true)
      const res = await fetch('/api/admin/game-topup-settings', { cache: 'no-store' })
      const data = await res.json()
      setGameTopupGames(data.games || [])
    } catch (error) {
      console.error('Failed to fetch game topup games:', error)
    } finally {
      setGameTopupLoading(false)
    }
  }

  const saveGame = async (id: string) => {
    setGameSaving(true)
    setGameTopupMsg(null)
    try {
      const res = await fetch('/api/admin/game-topup-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editGameData }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setGameTopupMsg({ type: 'err', text: body.error || 'Не удалось сохранить' })
        return
      }
      setEditingGameId(null)
      setEditGameData({})
      await fetchGameTopupGames()
      setGameTopupMsg({ type: 'ok', text: 'Настройки игры сохранены' })
    } catch {
      setGameTopupMsg({ type: 'err', text: 'Ошибка сети при сохранении' })
    } finally {
      setGameSaving(false)
    }
  }

  const createGame = async () => {
    if (!newGame.name.trim()) { setNewGameErr('Введите название игры'); return }
    if (!newGame.slug.trim()) { setNewGameErr('Введите slug'); return }
    setNewGameSaving(true)
    setNewGameErr('')
    try {
      let approute_service_ids = null
      if (newGame.approute_service_ids.trim()) {
        try { approute_service_ids = JSON.parse(newGame.approute_service_ids) } catch {
          setNewGameErr('Поле «Service IDs (JSON)» — невалидный JSON'); setNewGameSaving(false); return
        }
      }
      const res = await fetch('/api/admin/game-topup-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGame.name.trim(),
          slug: newGame.slug.trim(),
          markup_percent: newGame.markup_percent,
          usd_to_rub_rate: newGame.usd_to_rub_rate,
          image_url: newGame.image_url.trim() || null,
          approute_service_id: newGame.approute_service_id.trim() || null,
          approute_service_ids,
          account_fields: newGame.account_fields,
          is_active: newGame.is_active,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setNewGameErr(data.error || 'Ошибка сервера'); return }
      setNewGame({ ...EMPTY_NEW_GAME })
      setShowNewGame(false)
      await fetchGameTopupGames()
      setGameTopupMsg({ type: 'ok', text: `Игра «${data.game?.name}» добавлена` })
    } catch {
      setNewGameErr('Ошибка сети')
    } finally {
      setNewGameSaving(false)
    }
  }

  const syncGameTopups = async () => {
    setGameTopupSyncing(true)
    setGameTopupMsg(null)
    try {
      const res = await fetch('/api/admin/sync-game-topups', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setGameTopupMsg({ type: 'err', text: body.error || 'Ошибка синхронизации' })
        return
      }
      setGameTopupMsg({ type: 'ok', text: `Синхронизировано: ${body.total_synced} пакетов` })
      await fetchGameTopupGames()
    } catch {
      setGameTopupMsg({ type: 'err', text: 'Ошибка сети при синхронизации' })
    } finally {
      setGameTopupSyncing(false)
    }
  }

  const searchDtuCatalog = async () => {
    setDtuLoading(true)
    setDtuError('')
    try {
      const qs = dtuSearch.trim() ? `?search=${encodeURIComponent(dtuSearch.trim())}` : ''
      const res = await fetch(`/api/admin/approute-dtu-catalog${qs}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) { setDtuError(data.error || 'Ошибка'); return }
      setDtuResults(data.services || [])
    } catch { setDtuError('Ошибка сети') }
    finally { setDtuLoading(false) }
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

      {/* Telegram Stars / Premium: наценка и курс (синглтон telegram_settings) */}
      <div className="card mb-6">
        <div className="p-6 border-b border-border">
          <h2 className="text-[17px] font-bold text-navy">Telegram Stars и Premium</h2>
          <p className="text-sm text-muted mt-1">
            Наценка и курс USD→₽ для будущих продаж звёзд и Premium-подписки Telegram.
          </p>
        </div>

        <div className="p-6">
          {telegramMsg && (
            <div className={`alert mb-4 ${telegramMsg.type === 'ok' ? 'alert-success' : 'alert-error'}`}>
              <span>{telegramMsg.text}</span>
            </div>
          )}

          {!telegram ? (
            <div className="loading-block">
              <div className="spinner" />
              <span>Загрузка настроек...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label className="label">Наценка (%)</label>
                <input
                  type="number"
                  value={telegram.markup_percent}
                  onChange={(e) => setTelegram({ ...telegram, markup_percent: parseFloat(e.target.value) })}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="label">Курс USD к рублю</label>
                <input
                  type="number"
                  value={telegram.usd_to_rub_rate}
                  onChange={(e) => setTelegram({ ...telegram, usd_to_rub_rate: parseFloat(e.target.value) })}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  onClick={saveTelegram}
                  disabled={telegramSaving}
                  className="btn btn-primary"
                  data-loading={telegramSaving ? 'true' : undefined}
                >
                  Сохранить настройки Telegram
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* eSIM: наценка / курс / вкл-выкл витрины (синглтон esim_settings) */}
      <div className="card mb-6">
        <div className="p-6 border-b border-border">
          <h2 className="text-[17px] font-bold text-navy">eSIM</h2>
          <p className="text-sm text-muted mt-1">
            Наценка и курс USD→₽ для страницы «Купить eSIM» (/esim). Цена тарифа считается как
            ceil(цена_Dessly_в_USD × курс × (1 + наценка%/100)).
          </p>
        </div>

        <div className="p-6">
          {esimMsg && (
            <div className={`alert mb-4 ${esimMsg.type === 'ok' ? 'alert-success' : 'alert-error'}`}>
              <span>{esimMsg.text}</span>
            </div>
          )}

          {!esim ? (
            <div className="loading-block">
              <div className="spinner" />
              <span>Загрузка настроек...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <label className="flex items-center gap-3 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={esim.is_enabled}
                  onChange={(e) => setEsim({ ...esim, is_enabled: e.target.checked })}
                />
                <span className="font-semibold text-navy">Покупка eSIM включена</span>
                <span className="text-sm text-muted">(выключение скрывает страницу /esim)</span>
              </label>

              <div>
                <label className="label">Наценка (%)</label>
                <input
                  type="number"
                  value={esim.markup_percent}
                  onChange={(e) => setEsim({ ...esim, markup_percent: parseFloat(e.target.value) })}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="label">Курс USD к рублю</label>
                <input
                  type="number"
                  value={esim.usd_to_rub_rate}
                  onChange={(e) => setEsim({ ...esim, usd_to_rub_rate: parseFloat(e.target.value) })}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  onClick={saveEsim}
                  disabled={esimSaving}
                  className="btn btn-primary"
                  data-loading={esimSaving ? 'true' : undefined}
                >
                  Сохранить настройки eSIM
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Автоматический донат в игры: per-game наценка / курс / AppRoute service ID / изображение */}
      <div className="card mb-6">
        <div className="p-6 border-b border-border" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="text-[17px] font-bold text-navy">Автоматический донат в игры</h2>
            <p className="text-sm text-muted mt-1">
              Наценка / курс / AppRoute Service ID для каждой игры (/auto-games). Пакеты синкаются из AppRoute.
            </p>
          </div>
          <div className="flex gap-2" style={{ marginLeft: 16 }}>
            <button
              onClick={() => { setShowNewGame((v) => !v); setNewGameErr('') }}
              className="btn btn-primary btn-sm"
              style={{ whiteSpace: 'nowrap' }}
            >
              {showNewGame ? '✕ Отмена' : '+ Добавить игру'}
            </button>
            <button
              onClick={syncGameTopups}
              disabled={gameTopupSyncing}
              className="btn btn-outline btn-sm"
              data-loading={gameTopupSyncing ? 'true' : undefined}
              style={{ whiteSpace: 'nowrap' }}
            >
              {gameTopupSyncing ? '⟳ Синхронизация…' : '↻ Синхронизировать пакеты'}
            </button>
          </div>
        </div>

        <div className="p-6">
          {gameTopupMsg && (
            <div className={`alert mb-4 ${gameTopupMsg.type === 'ok' ? 'alert-success' : 'alert-error'}`}>
              <span>{gameTopupMsg.text}</span>
            </div>
          )}

          {/* Форма создания новой игры */}
          {showNewGame && (
            <div className="mb-5 p-4" style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--gray-bg)' }}>
              <div className="font-semibold text-navy mb-3" style={{ fontSize: 14 }}>Новая игра</div>
              <div className="flex flex-wrap gap-3 mb-3">
                <div style={{ flex: '1 1 200px' }}>
                  <label className="label">Название *</label>
                  <input
                    className="input"
                    placeholder="Genshin Impact"
                    value={newGame.name}
                    onChange={(e) => {
                      const name = e.target.value
                      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
                      setNewGame((g) => ({ ...g, name, slug }))
                    }}
                  />
                </div>
                <div style={{ flex: '1 1 160px' }}>
                  <label className="label">Slug * (URL)</label>
                  <input
                    className="input"
                    placeholder="genshin-impact"
                    value={newGame.slug}
                    onChange={(e) => setNewGame((g) => ({ ...g, slug: e.target.value }))}
                  />
                </div>
                <div style={{ flex: '0 0 90px' }}>
                  <label className="label">Наценка %</label>
                  <input
                    type="number"
                    className="input"
                    value={newGame.markup_percent}
                    onChange={(e) => setNewGame((g) => ({ ...g, markup_percent: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div style={{ flex: '0 0 90px' }}>
                  <label className="label">Курс USD→RUB</label>
                  <input
                    type="number"
                    className="input"
                    value={newGame.usd_to_rub_rate}
                    onChange={(e) => setNewGame((g) => ({ ...g, usd_to_rub_rate: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mb-3">
                <div style={{ flex: '1 1 200px' }}>
                  <label className="label">Service ID (одиночный)</label>
                  <input
                    className="input"
                    placeholder="abc123"
                    value={newGame.approute_service_id}
                    onChange={(e) => setNewGame((g) => ({ ...g, approute_service_id: e.target.value }))}
                  />
                </div>
                <div style={{ flex: '1 1 200px' }}>
                  <label className="label">Service IDs (мульти-регион, JSON)</label>
                  <input
                    className="input"
                    placeholder='{"cis":"id1","global":"id2"}'
                    value={newGame.approute_service_ids}
                    onChange={(e) => setNewGame((g) => ({ ...g, approute_service_ids: e.target.value }))}
                  />
                </div>
                <div style={{ flex: '1 1 220px' }}>
                  <label className="label">Изображение</label>
                  <ImageUploadField
                    value={newGame.image_url}
                    onChange={(url) => setNewGame((g) => ({ ...g, image_url: url }))}
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="label">
                  Поля аккаунта (JSON)
                  <span className="text-muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                    — массив объектов: {'{'}name, label, type: "text"|"select", required, options?{'}'}
                  </span>
                </label>
                <textarea
                  className="input"
                  rows={3}
                  style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                  placeholder='[{"name":"uid","label":"UID","type":"text","required":true}]'
                  value={newGame.account_fields}
                  onChange={(e) => setNewGame((g) => ({ ...g, account_fields: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2" style={{ fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={newGame.is_active}
                    onChange={(e) => setNewGame((g) => ({ ...g, is_active: e.target.checked }))}
                  />
                  Активна сразу
                </label>
                {newGameErr && <span style={{ fontSize: 12, color: '#ef4444' }}>{newGameErr}</span>}
                <button
                  onClick={createGame}
                  disabled={newGameSaving}
                  className="btn btn-primary btn-sm"
                  style={{ marginLeft: 'auto' }}
                >
                  {newGameSaving ? 'Сохранение…' : 'Создать игру'}
                </button>
              </div>
            </div>
          )}

          {/* Поиск по AppRoute DTU-каталогу для нахождения service ID */}
          <details className="mb-5" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            <summary style={{ padding: '10px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--navy)' }}>
              <i className="bi bi-search" aria-hidden="true" /> Найти AppRoute Service ID по названию игры
            </summary>
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Введите название игры (на английском), нажмите «Найти» — получите список сервисов AppRoute.
                DTU-сервисы (с полями аккаунта) выделены сверху. Скопируйте нужный ID в таблицу ниже.
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={dtuSearch}
                  onChange={(e) => setDtuSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchDtuCatalog()}
                  className="input"
                  placeholder="например: genshin, pubg, free fire…"
                  style={{ flex: 1 }}
                />
                <button onClick={searchDtuCatalog} disabled={dtuLoading} className="btn btn-outline btn-sm">
                  {dtuLoading ? '…' : 'Найти'}
                </button>
              </div>
              {dtuError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{dtuError}</div>}
              {dtuResults.length > 0 && (
                <div className="overflow-x-auto" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--card)' }}>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Название</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Service ID</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Раздел</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Пакетов</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Поля аккаунта</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dtuResults.map((s) => (
                        <tr key={s.id} style={{ borderTop: '1px solid var(--border)', background: s.hasDtuFields ? 'rgba(34,197,94,0.05)' : undefined }}>
                          <td style={{ padding: '4px 8px', color: 'var(--navy)', fontWeight: 500 }}>
                            {s.hasDtuFields && <span title="DTU-сервис (есть поля аккаунта)" style={{ color: '#22c55e', marginRight: 4 }}>●</span>}
                            {s.name}
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <code
                              style={{ background: 'var(--gray-bg)', padding: '1px 5px', borderRadius: 3, cursor: 'pointer', userSelect: 'all' }}
                              title="Кликните, чтобы скопировать"
                              onClick={() => navigator.clipboard.writeText(s.id)}
                            >
                              {s.id}
                            </code>
                          </td>
                          <td style={{ padding: '4px 8px', color: 'var(--muted)', fontSize: 11 }}>{s.type || '—'}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{s.section || '—'}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}>{s.denominationsCount}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{s.fields.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {dtuResults.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Найдено: {dtuResults.length} сервисов,{' '}
                  из них с полями аккаунта (DTU): {dtuResults.filter(s => s.hasDtuFields).length}
                </div>
              )}
              {dtuResults.length === 0 && !dtuLoading && dtuSearch && !dtuError && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Ничего не найдено. Попробуйте другой запрос или оставьте поле пустым, чтобы увидеть все сервисы.</div>
              )}
            </div>
          </details>

          {gameTopupLoading ? (
            <div className="loading-block">
              <div className="spinner" />
              <span>Загрузка…</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead className="bg-gray-bg border-b border-border">
                  <tr>
                    <th className="text-left p-3 font-semibold text-navy">Игра</th>
                    <th className="text-left p-3 font-semibold text-navy" style={{ width: 80 }}>Наценка %</th>
                    <th className="text-left p-3 font-semibold text-navy" style={{ width: 80 }}>Курс USD</th>
                    <th className="text-left p-3 font-semibold text-navy">AppRoute Service ID</th>
                    <th className="text-left p-3 font-semibold text-navy">Изображение URL</th>
                    <th className="text-center p-3 font-semibold text-navy" style={{ width: 80 }}>Активна</th>
                    <th className="text-right p-3 font-semibold text-navy" style={{ width: 100 }}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {gameTopupGames.map((game) => (
                    <tr key={game.id} className="border-b border-border hover:bg-gray-bg">
                      {editingGameId === game.id ? (
                        <>
                          <td className="p-3 font-semibold text-navy">{game.name}</td>
                          <td className="p-3">
                            <input
                              type="number"
                              value={String(editGameData.markup_percent ?? game.markup_percent)}
                              onChange={(e) => setEditGameData({ ...editGameData, markup_percent: parseFloat(e.target.value) })}
                              className="input"
                              style={{ width: 70 }}
                              min={0}
                              step={0.5}
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              value={String(editGameData.usd_to_rub_rate ?? game.usd_to_rub_rate)}
                              onChange={(e) => setEditGameData({ ...editGameData, usd_to_rub_rate: parseFloat(e.target.value) })}
                              className="input"
                              style={{ width: 70 }}
                              min={1}
                              step={0.5}
                            />
                          </td>
                          <td className="p-3">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
                              <input
                                type="text"
                                value={String(editGameData.approute_service_id ?? game.approute_service_id ?? '')}
                                onChange={(e) => setEditGameData({ ...editGameData, approute_service_id: e.target.value || null })}
                                className="input"
                                style={{ width: '100%', fontSize: 12 }}
                                placeholder="service_id (одиночный)"
                              />
                              <textarea
                                value={
                                  editGameData.approute_service_ids !== undefined
                                    ? (editGameData.approute_service_ids ? JSON.stringify(editGameData.approute_service_ids) : '')
                                    : (game.approute_service_ids ? JSON.stringify(game.approute_service_ids) : '')
                                }
                                onChange={(e) => {
                                  const v = e.target.value.trim()
                                  try {
                                    setEditGameData({ ...editGameData, approute_service_ids: v ? JSON.parse(v) : null })
                                  } catch {
                                    setEditGameData({ ...editGameData, approute_service_ids: v as any })
                                  }
                                }}
                                className="input"
                                rows={2}
                                style={{ width: '100%', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }}
                                placeholder={'{"cis":"id1","global":"id2"}'}
                              />
                            </div>
                          </td>
                          <td className="p-3" style={{ minWidth: 200 }}>
                            <ImageUploadField
                              value={String(editGameData.image_url ?? game.image_url ?? '')}
                              onChange={(url) => setEditGameData({ ...editGameData, image_url: url || null })}
                            />
                          </td>
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(editGameData.is_active ?? game.is_active)}
                              onChange={(e) => setEditGameData({ ...editGameData, is_active: e.target.checked })}
                            />
                          </td>
                          <td className="p-3">
                            <div className="flex gap-1.5 justify-end">
                              <button
                                onClick={() => saveGame(game.id)}
                                disabled={gameSaving}
                                className="btn btn-sm btn-primary"
                              >
                                <i className="bi bi-check-lg" aria-hidden="true" />
                              </button>
                              <button
                                onClick={() => { setEditingGameId(null); setEditGameData({}) }}
                                className="btn btn-sm btn-ghost"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-3">
                            <div className="font-semibold text-navy">{game.name}</div>
                            <div className="text-muted" style={{ fontSize: 11 }}>{game.slug}</div>
                          </td>
                          <td className="p-3 text-navy">{game.markup_percent}%</td>
                          <td className="p-3 text-navy">{game.usd_to_rub_rate}</td>
                          <td className="p-3">
                            {game.approute_service_id && (
                              <div><code style={{ fontSize: 11 }}>{game.approute_service_id}</code></div>
                            )}
                            {game.approute_service_ids && (
                              <div style={{ marginTop: 2 }}>
                                {Object.entries(game.approute_service_ids).map(([region, sid]) => (
                                  <div key={region} style={{ fontSize: 11 }}>
                                    <span style={{ color: 'var(--muted)', marginRight: 4 }}>{region}:</span>
                                    <code>{sid}</code>
                                  </div>
                                ))}
                              </div>
                            )}
                            {!game.approute_service_id && !game.approute_service_ids && (
                              <span style={{ fontSize: 11, color: '#f59e0b' }}>не задан</span>
                            )}
                          </td>
                          <td className="p-3">
                            {game.image_url ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <img src={game.image_url} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} />
                                <span className="text-muted" style={{ fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{game.image_url}</span>
                              </div>
                            ) : (
                              <span className="text-muted" style={{ fontSize: 11 }}>—</span>
                            )}
                          </td>
                          <td className="p-3 text-center">{game.is_active ? <i className="bi bi-check-circle-fill" style={{ color: '#22c55e' }} aria-hidden="true" /> : '—'}</td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => { setEditingGameId(game.id); setEditGameData({}) }}
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
