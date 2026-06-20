'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Блок «Купить Telegram Stars / Premium» — оплата с баланса, выдача АВТОМАТИЧЕСКАЯ через
 * AppRoute (POST /api/telegram/buy → createDtuOrder). Большинство заказов завершаются за
 * секунды (status: completed); если поставщик не успел — заказ остаётся pending и дозавершится
 * (см. /admin/telegram-orders), деньги уже списаны и не возвращаются (заказ принят).
 * Цена считается на сервере (telegram_settings: наценка% + курс USD→₽), фронту не доверяем.
 * Переключатель Stars/Premium — вверху окна, выбор пакета — чипы, как срок у прокси.
 */

type Mode = 'stars' | 'premium'

interface PackageOut {
  id: string
  amount: number
  label: string
  price: number
}

interface TelegramConfig {
  stars: PackageOut[]
  premium: PackageOut[]
}

// Telegram username принимается как @username, t.me/username или просто username —
// срезаем префикс и проверяем «голую» форму (как account_reference у AppRoute).
const BARE_USERNAME_RE = /^\w{5,32}$/
function cleanAccountReference(raw: string): string {
  return raw.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '')
}

export default function TelegramPurchase({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter()

  const [config, setConfig] = useState<TelegramConfig | null>(null)
  const [configError, setConfigError] = useState(false)

  const [mode, setMode] = useState<Mode>('stars')
  const [packageId, setPackageId] = useState('')
  const [username, setUsername] = useState('')

  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState('')
  const [result, setResult] = useState<{ price: number; label: string; username: string; mode: Mode; status: 'completed' | 'pending' } | null>(null)

  // Стабильный ключ идемпотентности на текущий выбор: повторный клик не купит дважды.
  const idemKey = useRef<string>('')
  const newIdemKey = () => {
    idemKey.current =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `tg-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  if (!idemKey.current) newIdemKey()

  useEffect(() => {
    fetch('/api/telegram/config')
      .then((r) => r.json())
      .then((c: Partial<TelegramConfig>) => {
        if (!c.stars || !c.premium) {
          setConfigError(true)
          return
        }
        setConfig({ stars: c.stars, premium: c.premium })
        setPackageId(c.stars[0]?.id || '')
      })
      .catch(() => setConfigError(true))
  }, [])

  const list = mode === 'stars' ? config?.stars || [] : config?.premium || []
  const selected = list.find((p) => p.id === packageId)

  const onMode = (m: Mode) => {
    if (m === mode) return
    setMode(m)
    setResult(null)
    setBuyError('')
    const nextList = m === 'stars' ? config?.stars || [] : config?.premium || []
    setPackageId(nextList[0]?.id || '')
  }

  // Смена параметров → новый ключ идемпотентности + сброс прошлого результата.
  useEffect(() => {
    newIdemKey()
    setResult(null)
    setBuyError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId, username])

  const cleanUsername = cleanAccountReference(username)
  const usernameOk = BARE_USERNAME_RE.test(cleanUsername)
  const canBuy = !buying && !!selected && usernameOk

  const buy = async () => {
    if (!canBuy || !selected) return
    setBuying(true)
    setBuyError('')
    try {
      const res = await fetch('/api/telegram/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: selected.id,
          recipient_username: cleanUsername,
          idempotency_key: idemKey.current,
        }),
      })
      if (res.status === 401) {
        router.push('/auth/login?redirect=/')
        return
      }
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.success) {
        setBuyError(body.error || 'Не удалось оформить покупку')
        return
      }
      setResult({
        price: Number(body.price) || selected.price,
        label: selected.label,
        username: cleanUsername,
        mode,
        status: body.status === 'completed' ? 'completed' : 'pending',
      })
      newIdemKey() // следующая покупка — новый ключ
    } catch {
      setBuyError('Ошибка сети, повторите попытку')
    } finally {
      setBuying(false)
    }
  }

  // Конфиг не загрузился — тихо скрываем, чтобы не ломать страницу.
  if (configError && !config) return null

  return (
    <section className={`tgs${embedded ? ' tgs--embedded' : ''}`}>
      <div className="tgs-card">
        {!embedded && (
          <header className="tgs-head">
            <div className="tgs-head-ic" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4L3 11l5 2 2 6 3-4 5 4z" />
              </svg>
            </div>
            <div className="tgs-head-txt">
              <h2 className="tgs-title">Telegram Stars и Premium</h2>
              <p className="tgs-sub">Оплата с баланса, выдача автоматическая — обычно за секунды.</p>
            </div>
          </header>
        )}

        {/* Переключатель Stars/Premium — вверху окна */}
        <div className="tgs-switch" role="tablist" aria-label="Telegram Stars или Premium">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'stars'}
            className={`tgs-switch-btn ${mode === 'stars' ? 'tgs-switch-btn--active' : ''}`}
            onClick={() => onMode('stars')}
          >
            ⭐ Telegram Stars
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'premium'}
            className={`tgs-switch-btn ${mode === 'premium' ? 'tgs-switch-btn--active' : ''}`}
            onClick={() => onMode('premium')}
          >
            💎 Telegram Premium
          </button>
        </div>

        {!config ? (
          <div className="tgs-skel">
            <div className="tgs-skel-row" />
            <div className="tgs-skel-row" />
            <div className="tgs-skel-row" style={{ width: '60%' }} />
          </div>
        ) : result ? (
          /* ======== УСПЕХ ======== */
          <div className="tgs-success">
            <div className="tgs-success-ic">✓</div>
            <div className="tgs-success-title">{result.status === 'completed' ? 'Готово!' : 'Заявка принята'}</div>
            <p className="tgs-success-sub">
              {result.mode === 'stars' ? 'Звёзды' : 'Premium-подписка'} «{result.label}» для @{result.username}
              {' '}— списано {result.price} ₽.
            </p>
            <p className="tgs-success-note">
              {result.status === 'completed'
                ? 'Уже отправлено получателю.'
                : 'Поставщик принял заказ, выдача займёт немного времени.'}
            </p>
            <button className="tgs-btn tgs-btn--secondary" onClick={() => setResult(null)}>
              Купить ещё
            </button>
          </div>
        ) : (
          /* ======== ФОРМА ПОКУПКИ ======== */
          <>
            <div className="tgs-field">
              <span className="tgs-label">{mode === 'stars' ? 'Количество звёзд' : 'Срок подписки'}</span>
              <div className="tgs-chips">
                {list.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`tgs-opt ${packageId === p.id ? 'tgs-opt--active' : ''}`}
                    onClick={() => setPackageId(p.id)}
                  >
                    <span className="tgs-opt-label">{p.label}</span>
                    <span className="tgs-opt-price">{p.price} ₽</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="tgs-field">
              <span className="tgs-label">Telegram-username получателя</span>
              <input
                className="tgs-input"
                type="text"
                placeholder="@username или t.me/username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                aria-label="Telegram-username получателя"
              />
              {username && !usernameOk && (
                <span className="tgs-hint-err">5–32 символа: латиница, цифры, _ (без пробелов)</span>
              )}
            </div>

            {/* Цена + покупка */}
            <div className="tgs-footer">
              <div className="tgs-price-box">
                {selected ? (
                  <span className="tgs-price-total">{selected.price} ₽</span>
                ) : (
                  <span className="tgs-muted">Выберите пакет</span>
                )}
              </div>
              <button className="tgs-btn tgs-btn--primary tgs-buy" onClick={buy} disabled={!canBuy}>
                {buying ? 'Оформляем…' : selected ? `Купить · ${selected.price} ₽` : 'Купить'}
              </button>
            </div>

            {buyError && <div className="tgs-error">{buyError}</div>}
            <p className="tgs-terms">
              Оплата спишется с баланса сразу, выдача автоматическая — обычно за несколько секунд.
            </p>
          </>
        )}
      </div>

      <style jsx>{TGS_CSS}</style>
    </section>
  )
}

const TGS_CSS = `
  .tgs { margin: 0 0 30px; }
  .tgs-card { background: var(--surface, #fff); border: 1px solid var(--border, #e6eaf0);
    border-radius: 16px; padding: 22px; }

  /* В модалке шапку/рамку/отступ даёт само окно — карточка становится «прозрачной». */
  .tgs--embedded { margin: 0; }
  .tgs--embedded .tgs-card { border: none; border-radius: 0; padding: 0; background: transparent; }

  .tgs-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
  .tgs-head-ic { flex: none; width: 46px; height: 46px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    background: var(--blue-50, #eaf4fd); color: var(--blue, #1c8ce3); }
  .tgs-title { font-size: 20px; font-weight: 800; color: var(--navy, #0f1e2e); margin: 0; letter-spacing: -0.01em; }
  .tgs-sub { color: var(--muted, #5b6472); margin: 2px 0 0; font-size: 13.5px; }

  /* Переключатель Stars/Premium */
  .tgs-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 18px; }
  .tgs-switch-btn { padding: 12px 14px; border: 1.5px solid var(--border, #e6eaf0); border-radius: 12px;
    background: #fff; color: var(--navy, #0f1e2e); font-size: 14.5px; font-weight: 700;
    cursor: pointer; transition: all .15s; min-height: 46px; }
  .tgs-switch-btn:hover { border-color: var(--blue-200, #bfddf7); }
  .tgs-switch-btn--active { border-color: var(--blue, #1c8ce3); background: var(--blue-50, #eaf4fd); color: var(--blue-700, #0f62a8); }

  /* Skeleton */
  .tgs-skel { display: grid; gap: 12px; }
  .tgs-skel-row { height: 40px; border-radius: 10px;
    background: linear-gradient(90deg, #eef2f8 25%, #f4f7fa 50%, #eef2f8 75%);
    background-size: 200% 100%; animation: tgs-shimmer 1.5s infinite; }
  @keyframes tgs-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  .tgs-field { display: grid; gap: 7px; margin-bottom: 16px; }
  .tgs-label { font-weight: 600; color: var(--navy, #0f1e2e); font-size: 13.5px; }
  .tgs-muted { color: var(--muted, #5b6472); font-size: 13px; }

  .tgs-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .tgs-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    padding: 9px 14px; border: 1.5px solid var(--border, #e6eaf0); border-radius: 10px;
    background: #fff; color: var(--navy, #0f1e2e); cursor: pointer; transition: all .15s; min-height: 52px; }
  .tgs-opt:hover { border-color: var(--blue-200, #bfddf7); }
  .tgs-opt--active { border-color: var(--blue, #1c8ce3); background: var(--blue-50, #eaf4fd); color: var(--blue-700, #0f62a8); }
  .tgs-opt-label { font-size: 13.5px; font-weight: 700; }
  .tgs-opt-price { font-size: 12px; color: var(--muted, #5b6472); }
  .tgs-opt--active .tgs-opt-price { color: var(--blue-700, #0f62a8); }

  .tgs-input { width: 100%; border: 1.5px solid var(--border, #e6eaf0); border-radius: 10px;
    padding: 11px 14px; font-size: 14px; color: var(--ink, #10202e); outline: none; transition: border-color .15s; }
  .tgs-input:focus { border-color: var(--blue, #1c8ce3); }
  .tgs-hint-err { font-size: 12px; color: var(--red, #d63b3b); }

  /* Footer: price + buy */
  .tgs-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px;
    margin-top: 4px; padding-top: 18px; border-top: 1px solid var(--border, #e6eaf0); flex-wrap: wrap; }
  .tgs-price-box { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .tgs-price-total { font-size: 26px; font-weight: 800; color: var(--navy, #0f1e2e); line-height: 1; }

  /* Buttons */
  .tgs-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: none;
    border-radius: 10px; font-weight: 700; font-size: 14.5px; cursor: pointer; padding: 11px 22px;
    min-height: 44px; transition: all .15s; text-decoration: none; }
  .tgs-btn:disabled { opacity: .55; cursor: not-allowed; }
  .tgs-btn--primary { background: var(--blue, #1c8ce3); color: #fff; }
  .tgs-btn--primary:hover:not(:disabled) { background: var(--blue-600, #1577c7); }
  .tgs-btn--secondary { background: var(--blue-50, #eaf4fd); color: var(--blue-700, #0f62a8); }
  .tgs-btn--secondary:hover { background: var(--blue-100, #d6eafb); }
  .tgs-buy { flex: none; }

  .tgs-error { margin-top: 14px; padding: 11px 14px; background: var(--red-bg, #fbeaea);
    color: var(--red, #d63b3b); border-radius: 10px; font-size: 13.5px; }
  .tgs-terms { margin: 12px 0 0; font-size: 12px; color: var(--muted-2, #869099); }

  /* Success */
  .tgs-success { text-align: center; padding: 12px 0 4px; }
  .tgs-success-ic { width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 50%;
    background: var(--green-bg, #e7f6ed); color: var(--green, #15a05a);
    display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; }
  .tgs-success-title { font-size: 17px; font-weight: 800; color: var(--navy, #0f1e2e); margin-bottom: 6px; }
  .tgs-success-sub { font-size: 13.5px; color: var(--navy, #0f1e2e); margin: 0 0 4px; }
  .tgs-success-note { font-size: 12.5px; color: var(--muted, #5b6472); margin: 0 0 16px; }

  /* Responsive */
  @media (max-width: 640px) {
    .tgs-card { padding: 16px 14px; }
    .tgs-footer { flex-direction: column; align-items: stretch; }
    .tgs-buy { width: 100%; }
  }

  /* Mini App */
  html.tg-webapp .tgs-card { padding: 14px 12px; }
`
