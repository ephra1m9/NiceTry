'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/hooks/useUser'
import type { GameTopupGame, GameTopupDenomination, AccountField } from '@/lib/game-topup-settings'
import Spinner from '@/components/ui/Spinner'
import Button from '@/components/ui/Button'
import { BI } from '@/components/ui/BI'

const GAME_GRADIENTS: Record<string, string> = {
  'genshin-impact':     'linear-gradient(135deg,#1a1a2e 0%,#4a0080 100%)',
  'pubg-mobile':        'linear-gradient(135deg,#0d1b2a 0%,#c47800 100%)',
  'blood-strike':       'linear-gradient(135deg,#1a0000 0%,#8b0000 100%)',
  'super-sus':          'linear-gradient(135deg,#0a0a1a 0%,#1e3a8a 100%)',
  'delta-force-mobile': 'linear-gradient(135deg,#0d1a0d 0%,#2d5a27 100%)',
  'free-fire':          'linear-gradient(135deg,#1a1000 0%,#b45309 100%)',
  'marvel-rivals':      'linear-gradient(135deg,#1a0010 0%,#7c0020 100%)',
  'mobile-legends-ru':  'linear-gradient(135deg,#00101a 0%,#005580 100%)',
  'zenless-zone-zero':  'linear-gradient(135deg,#0d0d1a 0%,#3b3b7a 100%)',
}

interface Props {
  game: GameTopupGame
  denominations: GameTopupDenomination[]
}

type PaymentMethod = 'balance' | 'card'

export default function GameTopupClient({ game, denominations }: Props) {
  const router = useRouter()
  const { user: authUser } = useAuth()
  const { user } = useUser()

  const [selectedDenomId, setSelectedDenomId] = useState<string | null>(
    denominations.length > 0 ? denominations[0].id : null
  )
  const [accountData, setAccountData] = useState<Record<string, string>>({})
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('balance')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string; orderId?: string } | null>(null)

  const gradient = GAME_GRADIENTS[game.slug] || 'linear-gradient(135deg,#1a1a2e 0%,#4a4a8a 100%)'
  const selectedDenom = denominations.find((d) => d.id === selectedDenomId) ?? null

  // Фильтрация деноминаций по выбранному региону (для PUBG Mobile).
  const regionField = game.account_fields.find((f) => f.name === 'region')
  const selectedRegion = accountData['region'] || (regionField?.options?.[0]?.value ?? null)
  const visibleDenominations = regionField
    ? denominations.filter((d) => !d.region || d.region === selectedRegion)
    : denominations

  function validate(): boolean {
    const nextErrors: Record<string, string> = {}
    if (!selectedDenomId) nextErrors.denomination = 'Выберите пакет пополнения'
    for (const field of game.account_fields) {
      if (field.required && !accountData[field.name]?.trim()) {
        nextErrors[field.name] = `Заполните поле «${field.label}»`
      }
    }
    if (paymentMethod === 'card' && !authUser) {
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        nextErrors.email = 'Укажите корректный email'
      }
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/auto-games/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_slug: game.slug,
          denomination_id: selectedDenomId,
          account_data: accountData,
          payment_method: paymentMethod,
          email: authUser?.email || email || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setResult({ success: false, message: data.error || 'Ошибка оформления заказа' })
        return
      }
      if (data.pay_url) {
        router.push(data.pay_url)
        return
      }
      setResult({
        success: true,
        message: data.result || 'Пополнение успешно зачислено!',
        orderId: data.order?.id,
      })
    } catch {
      setResult({ success: false, message: 'Ошибка сети. Попробуйте ещё раз.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container py-8">
      {/* Хлебные крошки */}
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
        <Link href="/auto-games" style={{ color: 'var(--muted)', textDecoration: 'none' }}>
          ← Донат в игры
        </Link>
        <span style={{ margin: '0 6px' }}>·</span>
        <span>{game.name}</span>
      </div>

      <div className="product-layout" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,280px) 1fr', gap: 32, alignItems: 'start' }}>
          {/* Обложка */}
          <div
            style={{
              background: game.image_url ? undefined : gradient,
              borderRadius: 16,
              overflow: 'hidden',
              aspectRatio: '3/4',
              position: 'relative',
            }}
          >
            {game.image_url && (
              <img
                src={game.image_url}
                alt={game.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
            {!game.image_url && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <i className="bi bi-controller" style={{ fontSize: 64, color: 'rgba(255,255,255,0.7)' }} aria-hidden="true" />
              </div>
            )}
          </div>

          {/* Правая панель */}
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{game.name}</h1>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <span className="badge" style={{ background: 'var(--badge-bg)', color: 'var(--badge-fg)' }}>
                Автопополнение
              </span>
              <span className="badge" style={{ background: 'rgba(34,197,94,.15)', color: '#16a34a' }}>
                Мгновенно
              </span>
            </div>

            {/* Успешный результат */}
            {result?.success && (
              <div className="card" style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.3)', marginBottom: 20, padding: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="bi bi-check-circle-fill" aria-hidden="true" />
                  Пополнение выполнено
                </div>
                <div style={{ fontSize: 14, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{result.message}</div>
                {result.orderId && (
                  <Link href={`/orders/${result.orderId}`} style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: 'var(--blue)' }}>
                    Перейти к заказу →
                  </Link>
                )}
              </div>
            )}

            {/* Ошибка */}
            {result && !result.success && (
              <div className="card" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', marginBottom: 20, padding: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: '#dc2626' }}>Ошибка</div>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>{result.message}</div>
              </div>
            )}

            {/* Форма аккаунта (вверху, перед выбором пакета, чтобы PUBG с регионом фильтровал деноминации) */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 15 }}>Данные аккаунта</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {game.account_fields.map((field: AccountField) => (
                  <div key={field.name}>
                    {field.type === 'select' ? (
                      <div>
                        <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                          {field.label}{field.required && <span style={{ color: '#ef4444' }}> *</span>}
                        </label>
                        <select
                          className="input"
                          value={accountData[field.name] || field.options?.[0]?.value || ''}
                          onChange={(e) => {
                            const newData = { ...accountData, [field.name]: e.target.value }
                            setAccountData(newData)
                            // Сброс выбранного пакета при смене региона
                            if (field.name === 'region') setSelectedDenomId(null)
                          }}
                          style={{ width: '100%' }}
                        >
                          {field.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        {errors[field.name] && (
                          <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{errors[field.name]}</div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                          {field.label}{field.required && <span style={{ color: '#ef4444' }}> *</span>}
                        </label>
                        <input
                          className={`input${errors[field.name] ? ' err' : ''}`}
                          value={accountData[field.name] || ''}
                          onChange={(e) => setAccountData({ ...accountData, [field.name]: e.target.value })}
                          placeholder={field.placeholder || field.label}
                          style={{ width: '100%' }}
                        />
                        {errors[field.name] && (
                          <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{errors[field.name]}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Выбор пакета */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 15 }}>Выберите пакет</div>
              {visibleDenominations.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                  {regionField ? 'Выберите регион для отображения пакетов' : 'Пакеты пока не добавлены'}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
                  {visibleDenominations.map((denom) => {
                    const isSelected = selectedDenomId === denom.id
                    return (
                      <button
                        key={denom.id}
                        type="button"
                        onClick={() => setSelectedDenomId(denom.id)}
                        style={{
                          border: `2px solid ${isSelected ? 'var(--blue)' : 'var(--border)'}`,
                          borderRadius: 10,
                          padding: '12px 14px',
                          background: isSelected ? 'rgba(59,130,246,.08)' : 'var(--card)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'border-color .15s',
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--fg)' }}>
                          {denom.name}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: isSelected ? 'var(--blue)' : 'var(--fg)' }}>
                          {denom.price_rub.toLocaleString('ru-RU')} ₽
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
              {errors.denomination && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{errors.denomination}</div>
              )}
            </div>

            {/* Способ оплаты */}
            {authUser && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 15 }}>Способ оплаты</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {(['balance', 'card'] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      style={{
                        border: `2px solid ${paymentMethod === m ? 'var(--blue)' : 'var(--border)'}`,
                        borderRadius: 8,
                        padding: '8px 16px',
                        background: paymentMethod === m ? 'rgba(59,130,246,.08)' : 'var(--card)',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: 'var(--fg)',
                      }}
                    >
                      {m === 'balance'
                        ? `Баланс${user ? ` (${Number(user.balance).toLocaleString('ru-RU')} ₽)` : ''}`
                        : 'Карта / СБП'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Email для гостя при оплате картой */}
            {!authUser && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Email для чека <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className={`input${errors.email ? ' err' : ''}`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  style={{ width: '100%' }}
                />
                {errors.email && (
                  <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{errors.email}</div>
                )}
              </div>
            )}

            {/* Итог и кнопка */}
            {selectedDenom && (
              <div
                style={{
                  background: 'rgba(59,130,246,.06)',
                  border: '1px solid rgba(59,130,246,.2)',
                  borderRadius: 10,
                  padding: '12px 16px',
                  marginBottom: 16,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>{selectedDenom.name}</span>
                <span style={{ fontWeight: 700, fontSize: 20, color: 'var(--blue)' }}>
                  {selectedDenom.price_rub.toLocaleString('ru-RU')} ₽
                </span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedDenomId || visibleDenominations.length === 0}
              style={{ width: '100%', fontSize: 16 }}
            >
              {submitting ? <Spinner label="Оформление…" /> : 'Оплатить и пополнить'}
            </Button>

            {/* Бенефиты */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 20 }}>
              {[
                { icon: 'lightning-charge', title: 'Мгновенно', sub: 'Зачисление сразу после оплаты' },
                { icon: 'shield-check', title: 'Безопасно', sub: 'Платёж через защищённый шлюз' },
                { icon: 'chat-dots', title: 'Поддержка 24/7', sub: 'Помогаем по любым вопросам' },
              ].map((b) => (
                <div key={b.icon} className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ marginBottom: 4 }}><BI name={b.icon} size="lg" /></div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{b.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{b.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
