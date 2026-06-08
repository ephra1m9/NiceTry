'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Alert from '@/components/ui/Alert'
import Input from '@/components/ui/Input'
import { NICKNAME_MIN, NICKNAME_MAX } from '@/lib/auth/nickname'

// Страница ожидания оплаты pay4game (PAYMENTS_MODE=live).
// Поллит /api/pay4game/status. Пока pending — показывает QR (desktop=картинка, mobile=iframe
// с диплинком qr.content). После оплаты: новый гость → шаг ника (finalize → авто-вход),
// иначе → переход в кабинет / предложение войти по коду.

interface StatusResp {
  invoice_id: string
  status: 'pending' | 'success' | 'declined' | 'refunded' | 'error'
  hold: number
  qr_content: string | null
  qr_img: string | null
  paid: boolean
  order: { id: string; status: string; has_owner: boolean } | null
  email?: string
  token?: string
}

function isMobile(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export default function PayClient({ invoiceId, payUrl }: { invoiceId: string; payUrl?: string }) {
  const [data, setData] = useState<StatusResp | null>(null)
  const [error, setError] = useState('')
  const [mobile, setMobile] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setMobile(isMobile()), [])

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/pay4game/status?invoice_id=${encodeURIComponent(invoiceId)}`, {
        cache: 'no-store',
      })
      const json = (await res.json()) as StatusResp & { error?: string }
      if (!res.ok) {
        setError(json.error || 'Не удалось получить статус платежа')
        return
      }
      setData(json)
      // Продолжаем поллинг, пока не финальный статус.
      if (json.status === 'pending') {
        timer.current = setTimeout(poll, 2500)
      }
    } catch {
      timer.current = setTimeout(poll, 4000)
    }
  }, [invoiceId])

  useEffect(() => {
    poll()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [poll])

  // ——— Шаг ника (после успешной оплаты, новый гость) ———
  const [nickname, setNickname] = useState('')
  const [nickState, setNickState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle')
  const [nickError, setNickError] = useState('')
  const [processing, setProcessing] = useState(false)
  const nickAbort = useRef<AbortController | null>(null)

  const needNickname = !!data?.paid && !!data.token && !data.order?.has_owner

  useEffect(() => {
    if (!needNickname) return
    const value = nickname.trim()
    if (!value) {
      setNickState('idle')
      setNickError('')
      return
    }
    setNickState('checking')
    const handle = setTimeout(async () => {
      nickAbort.current?.abort()
      const ctrl = new AbortController()
      nickAbort.current = ctrl
      try {
        const res = await fetch(`/api/user/nickname/check?nickname=${encodeURIComponent(value)}`, {
          signal: ctrl.signal,
        })
        const j = await res.json()
        if (!j.valid) {
          setNickState('invalid')
          setNickError(j.error || 'Недопустимый ник')
        } else {
          setNickState(j.available ? 'free' : 'taken')
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setNickState('idle')
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [nickname, needNickname])

  const handleFinalize = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!data?.order || !data.token || nickState !== 'free') return
    setProcessing(true)
    setError('')
    try {
      const res = await fetch('/api/checkout/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: data.order.id, token: data.token, nickname: nickname.trim() }),
      })
      const j = await res.json()
      if (!res.ok || !j.success) {
        if (res.status === 409) setNickState('taken')
        setError(j.error || 'Не удалось завершить оформление')
        setProcessing(false)
        return
      }
      window.location.href = '/profile'
    } catch {
      setError('Ошибка сети')
      setProcessing(false)
    }
  }

  // ——— Рендер ———
  const status = data?.status

  // Оплачено.
  if (data?.paid) {
    if (needNickname) {
      return (
        <Shell>
          <PaidBanner email={data.email} />
          <div className="text-center mb-5">
            <h1 className="text-[22px]">Придумайте никнейм</h1>
            <p className="text-muted text-sm mt-1.5">Создадим аккаунт на вашу почту и сохраним заказ</p>
          </div>
          <form onSubmit={handleFinalize} className="space-y-4">
            <div>
              <label htmlFor="nickname" className="label">Никнейм</label>
              <Input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="например, player_01"
                required
                disabled={processing}
                autoComplete="off"
                error={nickState === 'taken' || nickState === 'invalid'}
              />
              <div className="mt-1.5 text-[13px] min-h-[18px]">
                {nickState === 'checking' && <span className="text-muted-2">Проверяем…</span>}
                {nickState === 'free' && <span className="text-green-600">✓ Ник свободен</span>}
                {nickState === 'taken' && <span className="text-red-600">Этот ник уже занят</span>}
                {nickState === 'invalid' && <span className="text-red-600">{nickError}</span>}
                {nickState === 'idle' && (
                  <span className="text-muted-2">Латиница, цифры, _ и -, от {NICKNAME_MIN} до {NICKNAME_MAX} символов</span>
                )}
              </div>
            </div>
            {error && <Alert variant="error">{error}</Alert>}
            <Button type="submit" variant="primary" size="lg" loading={processing} block disabled={nickState !== 'free'}>
              Продолжить
            </Button>
          </form>
        </Shell>
      )
    }
    // Заказ привязан к аккаунту (сессия/существующий).
    return (
      <Shell>
        <PaidBanner email={data.email} />
        <h2 className="mb-2 text-center">Оплата прошла</h2>
        <p className="text-muted text-sm mb-5 text-center">Заказ оформлен и привязан к аккаунту.</p>
        <div className="space-y-3">
          <Link href="/profile" className="btn btn-primary btn-lg w-full">Перейти в кабинет</Link>
          {data.email && (
            <Link
              href={`/auth/login?redirect=/profile&identifier=${encodeURIComponent(data.email)}`}
              className="btn btn-outline w-full"
            >
              Войти по коду
            </Link>
          )}
        </div>
      </Shell>
    )
  }

  // Отказ / возврат.
  if (status === 'declined' || status === 'refunded' || status === 'error') {
    return (
      <Shell>
        <Alert variant="error">
          {status === 'refunded' ? 'Платёж возвращён.' : 'Оплата не прошла. Попробуйте ещё раз.'}
        </Alert>
        <Link href="/checkout" className="btn btn-primary btn-lg w-full mt-5">Вернуться к оплате</Link>
      </Shell>
    )
  }

  // Ожидание оплаты (pending).
  const qrImg = data?.qr_img
  const qrContent = data?.qr_content
  return (
    <Shell>
      <div className="text-center mb-5">
        <h1 className="text-[22px]">Оплата заказа</h1>
        <p className="text-muted text-sm mt-1.5">
          {qrImg || qrContent ? 'Отсканируйте QR или оплатите по ссылке' : 'Готовим платёж…'}
        </p>
      </div>

      {/* Desktop: QR-картинка. Mobile: iframe с диплинком qr.content. */}
      {!mobile && qrImg && (
        <div className="flex justify-center mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrImg.startsWith('data:') ? qrImg : `data:image/png;base64,${qrImg}`}
            alt="QR для оплаты"
            className="w-56 h-56 rounded-lg border border-border"
          />
        </div>
      )}
      {mobile && qrContent && (
        <div className="mb-4">
          <iframe src={qrContent} title="Оплата" className="w-full rounded-lg border border-border" style={{ height: 480 }} />
        </div>
      )}

      <div className="space-y-3">
        {qrContent && (
          <a href={qrContent} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg w-full">
            Открыть оплату
          </a>
        )}
        {!qrContent && payUrl && (
          <a href={payUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg w-full">
            Перейти к оплате
          </a>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 mt-5 text-sm text-muted">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        Ожидаем подтверждение оплаты…
      </div>
      {error && <div className="mt-4"><Alert variant="error">{error}</Alert></div>}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container py-12 flex justify-center">
      <div className="card card-pad max-w-md w-full">{children}</div>
    </div>
  )
}

function PaidBanner({ email }: { email?: string }) {
  return (
    <div className="alert alert-success mb-5">
      <svg className="ic ic-sm" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
      <div>
        <div className="font-semibold">Оплата прошла</div>
        {email && <p className="text-[13px] opacity-90 mt-0.5">Заказ оформлен на {email}.</p>}
      </div>
    </div>
  )
}
