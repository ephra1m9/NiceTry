'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [devLoading, setDevLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Ошибка отправки')
        return
      }
      setMessage(data.message)
      setEmail('')
    } catch (err) {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  // Локальный вход без письма (обходит лимит почты Supabase). Только в dev-режиме.
  const handleDevLogin = async () => {
    if (!email) {
      setError('Введите email')
      return
    }
    setDevLoading(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Ошибка входа')
        return
      }
      window.location.href = '/'
    } catch (err) {
      setError('Ошибка сети')
    } finally {
      setDevLoading(false)
    }
  }

  return (
    <div className="container flex items-center justify-center py-12 sm:py-20 min-h-[70vh]">
      <div className="w-full max-w-md">
        {/* Логотип */}
        <Link href="/" className="flex justify-center mb-6" aria-label="NiceTry">
          <svg viewBox="0 0 250 56" style={{ height: 38 }} xmlns="http://www.w3.org/2000/svg">
            <text x="0" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#1C8CE3">N</text>
            <text x="30" y="42" fontFamily="Arial" fontWeight="900" fontSize="46" fill="#0F1E2E">T</text>
            <text x="72" y="31" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#1C8CE3">Nice</text>
            <text x="118" y="50" fontFamily="'Segoe Script','Brush Script MT',cursive" fontStyle="italic" fontSize="31" fill="#0F1E2E">try</text>
          </svg>
        </Link>

        <div className="card card-pad">
          <div className="text-center mb-6">
            <h1 className="text-[22px]">Вход в аккаунт</h1>
            <p className="text-muted text-sm mt-1.5">Введите email — мы отправим ссылку для входа</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                disabled={loading || devLoading}
                autoComplete="email"
                error={!!error}
              />
            </div>

            {error && <Alert variant="error">{error}</Alert>}
            {message && <Alert variant="success">{message}</Alert>}

            <Button type="submit" variant="primary" size="lg" loading={loading} block>
              Получить ссылку для входа
            </Button>

            {(
              <Button type="button" variant="ghost" onClick={handleDevLogin} loading={devLoading} block>
                Войти без письма
              </Button>
            )}
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-2">
            Нет аккаунта? Просто введите email — мы создадим его автоматически.
          </p>
        </div>
      </div>
    </div>
  )
}
