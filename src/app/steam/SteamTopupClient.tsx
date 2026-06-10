'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import {
  STEAM_REGIONS,
  DEFAULT_REGION,
  chargeRub,
  commissionRub,
  isValidSteamAccount,
  normalizeSteamAccount,
  type SteamTopupConfig,
} from '@/lib/steam-topup'

// Форма пополнения Steam-кошелька (карточка «Пополни Steam» на главной → /steam).
// РЕГИОН · СУММА (₽) · логин Steam · email → POST /api/steam/topup → страница оплаты /pay.

interface Props {
  config: SteamTopupConfig
  /** Email из активной сессии (если есть) — поле email тогда не обязательно. */
  sessionEmail?: string | null
}

const QUICK_AMOUNTS = [100, 300, 500, 1000, 2500, 5000]

export default function SteamTopupClient({ config, sessionEmail }: Props) {
  const router = useRouter()
  const [region, setRegion] = useState(DEFAULT_REGION)
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState<string>('500')
  const [email, setEmail] = useState(sessionEmail ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const steamAmount = Math.round(Number(amount) || 0)
  const amountValid = steamAmount >= config.min && steamAmount <= config.max
  const accountClean = normalizeSteamAccount(account)
  const accountValid = isValidSteamAccount(accountClean)
  const emailValid = !!sessionEmail || /\S+@\S+\.\S+/.test(email.trim())

  const { commission, charge } = useMemo(
    () => ({
      commission: commissionRub(steamAmount, config.commissionPercent),
      charge: chargeRub(steamAmount, config.commissionPercent),
    }),
    [steamAmount, config.commissionPercent]
  )

  const canSubmit = accountValid && amountValid && emailValid && !submitting
  const activeRegion = STEAM_REGIONS.find((r) => r.code === region) ?? STEAM_REGIONS[0]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/steam/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: accountClean,
          region,
          amount: steamAmount,
          ...(sessionEmail ? {} : { email: email.trim() }),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || 'Не удалось создать платёж')
        setSubmitting(false)
        return
      }
      // live → страница ожидания оплаты (QR/ссылка); mock → демо «оплачено» (та же страница статуса
      // отдаёт paid сразу), либо профиль для существующего/сессионного.
      if (json.pay_url) {
        router.push(json.pay_url)
        return
      }
      // mock без pay_url — показываем успех.
      router.push('/profile')
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.')
      setSubmitting(false)
    }
  }

  return (
    <div className="container py-8" style={{ maxWidth: 560 }}>
      <div className="mb-5">
        <h1 className="text-[26px] font-bold">Пополнение Steam-кошелька</h1>
        <p className="text-muted text-sm mt-1.5">
          Мгновенное зачисление по честному курсу. Комиссия всего {config.commissionPercent}%, поддержка 24/7.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card card-pad space-y-5">
        {/* Регион */}
        <div>
          <label className="label">Регион Steam-аккаунта</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {STEAM_REGIONS.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => setRegion(r.code)}
                className={`btn ${region === r.code ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                aria-pressed={region === r.code}
              >
                {r.countryCode ? (
                  // Картинка флага (emoji-флаги не рендерятся на Windows). alt=код → деградация в текст.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://flagcdn.com/w40/${r.countryCode}.png`}
                    width={20}
                    height={15}
                    alt={r.code}
                    style={{ marginRight: 6, borderRadius: 2, objectFit: 'cover', verticalAlign: '-3px' }}
                  />
                ) : (
                  <span aria-hidden style={{ marginRight: 6 }}>🌍</span>
                )}
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-muted-2 text-[13px] mt-1.5">
            Валюта кошелька: {activeRegion.walletCurrency === '—' ? 'определит Steam' : activeRegion.walletCurrency}.
            Зачисление в валюте аккаунта по курсу сервиса.
          </p>
        </div>

        {/* Логин Steam */}
        <div>
          <label htmlFor="steam-account" className="label">Логин Steam</label>
          <Input
            id="steam-account"
            type="text"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="например, player_2024"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            error={account.length > 0 && !accountValid}
            required
          />
          <p className="text-muted-2 text-[13px] mt-1.5">
            Это <b>логин для входа</b> в Steam, не ник профиля. Проверьте перед оплатой.
          </p>
        </div>

        {/* Сумма */}
        <div>
          <label htmlFor="steam-amount" className="label">Сумма пополнения, ₽</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmount(String(a))}
                className={`btn ${steamAmount === a ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              >
                {a} ₽
              </button>
            ))}
          </div>
          <Input
            id="steam-amount"
            type="number"
            inputMode="numeric"
            min={config.min}
            max={config.max}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amount.length > 0 && !amountValid}
            required
          />
          <p className="text-muted-2 text-[13px] mt-1.5">
            От {config.min} до {config.max} ₽.
          </p>
        </div>

        {/* Email (для гостя) */}
        {!sessionEmail && (
          <div>
            <label htmlFor="steam-email" className="label">Email для чека</label>
            <Input
              id="steam-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              error={email.length > 0 && !emailValid}
              required
            />
          </div>
        )}

        {/* Итог */}
        <div className="rounded-lg border border-border p-3 text-sm space-y-1" style={{ background: 'rgba(0,0,0,.02)' }}>
          <div className="flex justify-between">
            <span className="text-muted">Зачислится в Steam</span>
            <span>{amountValid ? steamAmount : '—'} ₽</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Комиссия {config.commissionPercent}%</span>
            <span>{amountValid ? commission : '—'} ₽</span>
          </div>
          <div className="flex justify-between font-semibold text-base pt-1 border-t border-border mt-1">
            <span>К оплате</span>
            <span>{amountValid ? charge : '—'} ₽</span>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Button type="submit" variant="primary" size="lg" block loading={submitting} disabled={!canSubmit}>
          Пополнить на {amountValid ? charge : '—'} ₽
        </Button>
        <p className="text-muted-2 text-[12px] text-center">
          Нажимая «Пополнить», вы соглашаетесь с условиями сервиса. Возврат — по правилам платёжной системы.
        </p>
      </form>
    </div>
  )
}
