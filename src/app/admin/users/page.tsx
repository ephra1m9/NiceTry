'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface User {
  id: string
  email: string
  telegram_username?: string
  balance: number
  is_admin: boolean
  created_at: string
  user_statuses?: {
    name: string
    discount_percent: number
  }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)

      const res = await fetch(`/api/admin/users?${params}`)
      const data = await res.json()
      setUsers(data.users || [])
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    fetchUsers()
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Пользователи</h1>
        <p className="text-muted">Управление пользователями и балансами</p>
      </div>

      {/* Поиск */}
      <div className="card card-pad mb-6">
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Поиск по email или Telegram..."
            className="input flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch} className="btn btn-primary">
            Найти
          </button>
        </div>
      </div>

      {/* Список пользователей */}
      {loading ? (
        <div className="text-center py-12 text-muted">Загрузка...</div>
      ) : users.length === 0 ? (
        <div className="card card-pad text-center py-12 text-muted">
          Пользователи не найдены
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Email
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Telegram
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Статус
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Баланс
                  </th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">
                    Роль
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">
                    Регистрация
                  </th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-border hover:bg-gray-bg"
                  >
                    <td className="p-4">
                      <div className="font-semibold text-navy">{user.email}</div>
                    </td>
                    <td className="p-4 text-muted">
                      {user.telegram_username ? `@${user.telegram_username}` : '—'}
                    </td>
                    <td className="p-4">
                      <span className="badge badge-instant">
                        {user.user_statuses?.name || 'Bronze'}
                      </span>
                    </td>
                    <td className="p-4 text-right font-semibold text-navy">
                      {Number(user.balance).toFixed(2)} ₽
                    </td>
                    <td className="p-4 text-center">
                      {user.is_admin && (
                        <span className="badge badge-amber">Админ</span>
                      )}
                    </td>
                    <td className="p-4 text-muted">
                      {new Date(user.created_at).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="btn btn-sm btn-ghost"
                      >
                        Управление
                      </Link>
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
