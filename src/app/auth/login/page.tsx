'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import { NICKNAME_MIN, NICKNAME_MAX } from '@/lib/auth/nickname'

// Вход в новой сессии: 1) ник/почта → код на почту (Resend); 2) код → сессия;
// 3) если у аккаунта ещё нет ника — «придумайте ник» (live-проверка свободен/занят).
// Старый magic-link (письмо от Supabase) убран — письма шлёт только наш код через Resend.

type Step = 'identifier' | 'code' | 'nickname'

const RESEND_COOLDOWN_SEC = 60
const isDev = process.env.NODE_ENV !== 'production'

export default function LoginPage() {
  const router = useRouter()

  const [step, setStep] = useState<Step>('identifier')
  const [identifier, setIdentifier] = useState('') // ник ИЛИ почта
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')

  const [loading, setLoading] = useState(false)
  const [devLoading, setDevLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Залогиненный пользователь без ника может прийти из профиля по ссылке ?step=nickname.
  // ?identifier= предзаполняет ник/почту (например, переход из гостевого чекаута «у вас есть аккаунт»).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('step') === 'nickname') setStep('nickname')
    const id = sp.get('identifier')
    if (id) setIdentifier(id)
  }, [])

  // Кулдаун повторной отправки кода.
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  // Live-проверка ника (debounce).
  const [nickState, setNickState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle')
  const [nickError, setNickError] = useState('')
  const nickAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    if (step !== 'nickname') return
    const value = nickname.trim()
    if (!value) {
      setNickState('idle')
      setNickError('')
      return
    }
    setNickState('checking')
    setNickError('')
    const handle = setTimeout(async () => {
      nickAbort.current?.abort()
      const ctrl = new AbortController()
      nickAbort.current = ctrl
      try {
        const res = await fetch(`/api/user/nickname/check?nickname=${encodeURIComponent(value)}`, {
          signal: ctrl.signal,
        })
        const data = await res.json()
        if (!data.valid) {
          setNickState('invalid')
          setNickError(data.error || 'Недопустимый ник')
        } else {
          setNickState(data.available ? 'free' : 'taken')
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setNickState('idle')
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [nickname, step])

  // ——— Шаг 1: отправка кода ———
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Не удалось отправить код')
        return
      }
      setStep('code')
      setInfo(data.message || 'Код отправлен на вашу почту')
      setCooldown(RESEND_COOLDOWN_SEC)
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  // Повторная отправка кода.
  const handleResend = async () => {
    if (cooldown > 0 || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Не удалось отправить код')
        return
      }
      setInfo('Новый код отправлен')
      setCooldown(RESEND_COOLDOWN_SEC)
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  // ——— Шаг 2: проверка кода ———
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || 'Неверный код')
        return
      }
      if (data.needsNickname) {
        setStep('nickname')
      } else {
        // Сессия выдана — на главную (профиль доступен из меню).
        window.location.href = '/'
      }
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  // ——— Шаг 3: выбор ника ———
  const handleSetNickname = async (e: React.FormEvent) => {
    e.preventDefault()
    if (nickState !== 'free') return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/user/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        if (res.status === 409) setNickState('taken')
        setError(data.error || 'Не удалось сохранить ник')
        return
      }
      window.location.href = '/profile'
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  // Dev-вход без письма (только локально).
  const handleDevLogin = async () => {
    if (!identifier.includes('@')) {
      setError('Для входа без письма введите email')
      return
    }
    setDevLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Ошибка входа')
        return
      }
      window.location.href = '/'
    } catch {
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
          {/* ШАГ 1 — ник или почта */}
          {step === 'identifier' && (
            <>
              <div className="text-center mb-6">
                <h1 className="text-[22px]">Вход в аккаунт</h1>
                <p className="text-muted text-sm mt-1.5">Введите ник или email — отправим код для входа</p>
              </div>

              <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                  <label htmlFor="identifier" className="label">Ник или Email</label>
                  <Input
                    id="identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="ваш ник или your@email.com"
                    required
                    disabled={loading || devLoading}
                    autoComplete="username"
                    error={!!error}
                  />
                </div>

                {error && <Alert variant="error">{error}</Alert>}

                <Button type="submit" variant="primary" size="lg" loading={loading} block>
                  Получить код
                </Button>

                {isDev && (
                  <Button type="button" variant="ghost" onClick={handleDevLogin} loading={devLoading} block>
                    Войти без письма (dev)
                  </Button>
                )}
              </form>

              <p className="mt-6 text-center text-[13px] text-muted-2">
                Нет аккаунта? Введите email — мы создадим его автоматически.
              </p>
            </>
          )}

          {/* ШАГ 2 — код */}
          {step === 'code' && (
            <>
              <div className="text-center mb-6">
                <h1 className="text-[22px]">Введите код</h1>
                <p className="text-muted text-sm mt-1.5">Мы отправили код для входа на вашу почту</p>
              </div>

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label htmlFor="code" className="label">Код из письма</label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="______"
                    maxLength={6}
                    required
                    disabled={loading}
                    error={!!error}
                    className="text-center tracking-[0.5em] text-lg"
                  />
                </div>

                {error && <Alert variant="error">{error}</Alert>}
                {info && !error && <Alert variant="success">{info}</Alert>}

                <Button type="submit" variant="primary" size="lg" loading={loading} block disabled={code.length < 6}>
                  Войти
                </Button>

                <div className="flex items-center justify-between text-[13px]">
                  <button
                    type="button"
                    className="text-muted-2 hover:text-navy"
                    onClick={() => {
                      setStep('identifier')
                      setCode('')
                      setError('')
                      setInfo('')
                    }}
                  >
                    ← Изменить ник/почту
                  </button>
                  <button
                    type="button"
                    className="text-blue-700 disabled:text-muted-2 disabled:cursor-not-allowed"
                    onClick={handleResend}
                    disabled={cooldown > 0 || loading}
                  >
                    {cooldown > 0 ? `Отправить ещё раз (${cooldown})` : 'Отправить код ещё раз'}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* ШАГ 3 — ник */}
          {step === 'nickname' && (
            <>
              <div className="text-center mb-6">
                <h1 className="text-[22px]">Придумайте никнейм</h1>
                <p className="text-muted text-sm mt-1.5">Этот ник будет виден другим пользователям</p>
              </div>

              <form onSubmit={handleSetNickname} className="space-y-4">
                <div>
                  <label htmlFor="nickname" className="label">Никнейм</label>
                  <Input
                    id="nickname"
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="например, player_01"
                    required
                    disabled={loading}
                    autoComplete="off"
                    error={nickState === 'taken' || nickState === 'invalid'}
                  />
                  <div className="mt-1.5 text-[13px] min-h-[18px]">
                    {nickState === 'checking' && <span className="text-muted-2">Проверяем…</span>}
                    {nickState === 'free' && <span className="text-green-600"><i className="bi bi-check-lg" aria-hidden="true" /> Ник свободен</span>}
                    {nickState === 'taken' && <span className="text-red-600">Этот ник уже занят</span>}
                    {nickState === 'invalid' && <span className="text-red-600">{nickError}</span>}
                    {nickState === 'idle' && (
                      <span className="text-muted-2">
                        Латиница, цифры, _ и -, от {NICKNAME_MIN} до {NICKNAME_MAX} символов
                      </span>
                    )}
                  </div>
                </div>

                {error && <Alert variant="error">{error}</Alert>}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading}
                  block
                  disabled={nickState !== 'free'}
                >
                  Продолжить
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
