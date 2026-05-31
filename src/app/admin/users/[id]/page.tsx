'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface User {
  id: string
  email: string
  telegram_username?: string
  balance: number
  is_admin: boolean
  status_id: string
  created_at: string
  user_statuses?: {
    name: string
    discount_percent: number
  }
  stats?: {
    orders_count: number
    total_spent: number
    referrals_count: number
  }
}

interface UserStatus {
  id: string
  name: string
  discount_percent: number
}

export default function AdminUserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [user, setUser] = useState<User | null>(null)
  const [statuses, setStatuses] = useState<UserStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  const [newBalance, setNewBalance] = useState('')
  const [balanceReason, setBalanceReason] = useState('')
  const [newStatusId, setNewStatusId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetchUser()
    fetchStatuses()
  }, [userId])

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`)
      const data = await res.json()
      setUser(data.user)
      setNewBalance(String(data.user.balance))
      setNewStatusId(data.user.status_id)
      setIsAdmin(data.user.is_admin)
    } catch (error) {
      console.error('Failed to fetch user:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchStatuses = async () => {
    try {
      const res = await fetch('/api/admin/settings/statuses')
      const data = await res.json()
      setStatuses(data.statuses || [])
    } catch (error) {
      console.error('Failed to fetch statuses:', error)
    }
  }

  const handleUpdateBalance = async () => {
    if (!balanceReason.trim()) {
      alert('Укажите причину изменения баланса')
      return
    }

    setUpdating(true)

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          balance: parseFloat(newBalance),
          balance_reason: balanceReason,
        }),
      })

      if (res.ok) {
        alert('Баланс обновлён')
        setBalanceReason('')
        fetchUser()
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to update balance:', error)
      alert('Ошибка при обновлении баланса')
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdateStatus = async () => {
    setUpdating(true)

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status_id: newStatusId,
        }),
      })

      if (res.ok) {
        alert('Статус обновлён')
        fetchUser()
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to update status:', error)
      alert('Ошибка при обновлении статуса')
    } finally {
      setUpdating(false)
    }
  }

  const handleToggleAdmin = async () => {
    const newAdminStatus = !isAdmin

    if (
      newAdminStatus &&
      !confirm('Назначить пользователя администратором?')
    ) {
      return
    }

    setUpdating(true)

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_admin: newAdminStatus,
        }),
      })

      if (res.ok) {
        alert(
          newAdminStatus
            ? 'Пользователь назначен администратором'
            : 'Права администратора отозваны'
        )
        setIsAdmin(newAdminStatus)
        fetchUser()
      } else {
        const data = await res.json()
        alert(`Ошибка: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to toggle admin:', error)
      alert('Ошибка при изменении прав')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl">
        <div className="text-center py-12 text-muted">Загрузка...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="max-w-4xl">
        <div className="card card-pad text-center py-12 text-muted">
          Пользователь не найден
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">{user.email}</h1>
        <p className="text-muted">
          Регистрация: {new Date(user.created_at).toLocaleDateString('ru-RU')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Статистика */}
        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="card card-pad">
              <div className="text-muted-2 text-sm mb-1">Заказов</div>
              <div className="text-2xl font-bold text-navy">
                {user.stats?.orders_count || 0}
              </div>
            </div>

            <div className="card card-pad">
              <div className="text-muted-2 text-sm mb-1">Потрачено</div>
              <div className="text-2xl font-bold text-navy">
                {user.stats?.total_spent.toFixed(2) || '0.00'} ₽
              </div>
            </div>

            <div className="card card-pad">
              <div className="text-muted-2 text-sm mb-1">Рефералов</div>
              <div className="text-2xl font-bold text-navy">
                {user.stats?.referrals_count || 0}
              </div>
            </div>
          </div>
        </div>

        {/* Управление балансом */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card card-pad">
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Управление балансом
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Текущий баланс
                </label>
                <div className="text-2xl font-bold text-navy mb-4">
                  {Number(user.balance).toFixed(2)} ₽
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Новый баланс (₽)
                </label>
                <input
                  type="number"
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                  className="input"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Причина изменения *
                </label>
                <input
                  type="text"
                  value={balanceReason}
                  onChange={(e) => setBalanceReason(e.target.value)}
                  className="input"
                  placeholder="Например: Компенсация за ошибку"
                />
              </div>

              <button
                onClick={handleUpdateBalance}
                disabled={updating}
                className="btn btn-primary"
              >
                {updating ? 'Обновление...' : 'Изменить баланс'}
              </button>
            </div>
          </div>

          <div className="card card-pad">
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Управление статусом
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Текущий статус
                </label>
                <div className="mb-4">
                  <span className="badge badge-instant text-sm">
                    {user.user_statuses?.name || 'Bronze'} (
                    {user.user_statuses?.discount_percent || 0}% скидка)
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-navy mb-2">
                  Новый статус
                </label>
                <select
                  value={newStatusId}
                  onChange={(e) => setNewStatusId(e.target.value)}
                  className="input"
                >
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name} ({status.discount_percent}% скидка)
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleUpdateStatus}
                disabled={updating}
                className="btn btn-primary"
              >
                {updating ? 'Обновление...' : 'Изменить статус'}
              </button>
            </div>
          </div>
        </div>

        {/* Информация и права */}
        <div className="space-y-6">
          <div className="card card-pad">
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Информация
            </h3>

            <div className="space-y-3">
              <div>
                <div className="text-sm text-muted mb-1">Email</div>
                <div className="font-semibold text-navy">{user.email}</div>
              </div>

              {user.telegram_username && (
                <div>
                  <div className="text-sm text-muted mb-1">Telegram</div>
                  <div className="font-semibold text-navy">
                    @{user.telegram_username}
                  </div>
                </div>
              )}

              <div>
                <div className="text-sm text-muted mb-1">ID</div>
                <div className="font-mono text-xs text-muted-2">{user.id}</div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <h3 className="text-[17px] font-bold text-navy mb-4">
              Права доступа
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-navy">
                  Администратор
                </span>
                <span
                  className={`badge ${
                    isAdmin ? 'badge-amber' : 'badge-out'
                  }`}
                >
                  {isAdmin ? 'Да' : 'Нет'}
                </span>
              </div>

              <button
                onClick={handleToggleAdmin}
                disabled={updating}
                className={`btn btn-sm w-full ${
                  isAdmin ? 'btn-ghost text-red' : 'btn-secondary'
                }`}
              >
                {isAdmin ? 'Отозвать права' : 'Назначить админом'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
