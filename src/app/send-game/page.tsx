'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTelegram } from '@/hooks/useTelegram'
import { computeGiftTotal, isSteamInviteUrl } from '@/lib/dessly-gift'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameEntry {
  app_id: number
  name: string
  image_url: string | null
  image_fallback: boolean
  popular: boolean
}

interface EditionEntry {
  edition: string
  packageId: number
  price: number
  priceOriginal: number
  discount: number
  region: string
}

interface DesslyConfig {
  enabled?: boolean
  commission_percent: number
  mode: 'embed' | 'native'
  widget_url: string | null
  regions: string[]
}

type Step = 'game' | 'details' | 'confirm'
type PageState = 'loading' | 'ready' | 'error' | 'success'

// ISO 3166-1 alpha-2 codes for flag images (region code → flag country code).
// Эмодзи-флаги не рендерятся на Windows (показываются как «RU»), поэтому используем
// растровые/векторные флаги с flagcdn — выглядят одинаково на всех платформах.
const REGION_CC: Record<string, string> = {
  RU: 'ru', KZ: 'kz', UA: 'ua', TR: 'tr', CN: 'cn',
  KR: 'kr', ID: 'id', VN: 'vn', IN: 'in',
  US: 'us', PL: 'pl', DE: 'de', FR: 'fr', UK: 'gb',
}

const REGION_NAMES: Record<string, string> = {
  RU: 'Россия', KZ: 'Казахстан', UA: 'Украина', TR: 'Турция',
  CN: 'Китай', KR: 'Южная Корея', ID: 'Индонезия', VN: 'Вьетнам', IN: 'Индия',
  US: 'США', PL: 'Польша', DE: 'Германия', FR: 'Франция', UK: 'Великобритания',
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SendGamePage() {
  const router = useRouter()
  const { isTelegram } = useTelegram()

  // Config
  const [config, setConfig] = useState<DesslyConfig | null>(null)

  // Games
  const [games, setGames] = useState<GameEntry[]>([])
  const [gamesTotal, setGamesTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [pageState, setPageState] = useState<PageState>('loading')
  const [errorText, setErrorText] = useState('')

  // Selection
  const [step, setStep] = useState<Step>('game')
  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(null)
  const [region, setRegion] = useState('RU')
  const [editions, setEditions] = useState<EditionEntry[]>([])
  const [editionsLoading, setEditionsLoading] = useState(false)
  const [selectedEdition, setSelectedEdition] = useState<EditionEntry | null>(null)
  const [invite, setInvite] = useState('')

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [orderResult, setOrderResult] = useState<{
    order_number?: string
    status?: string
  } | null>(null)

  // ---- Config fetch ----
  useEffect(() => {
    fetch('/api/dessly/config')
      .then((r) => r.json())
      .then((c: DesslyConfig) => {
        setConfig(c)
        if (c.regions?.length) setRegion(c.regions[0])
      })
      .catch(() => setConfig({ commission_percent: 4, mode: 'native', widget_url: null, regions: ['RU'] }))
  }, [])

  // ---- Games fetch (debounced server-side search) ----
  const [fetchId, setFetchId] = useState(0)
  useEffect(() => {
    const q = search.trim()
    const params = new URLSearchParams()
    params.set('limit', q ? '5000' : '500')
    params.set('sort', 'popularity')
    if (q) params.set('search', q)

    const id = fetchId + 1
    setFetchId(id)
    setPageState('loading')

    const timer = setTimeout(() => {
      fetch(`/api/dessly/games?${params}`)
        .then((r) => r.json())
        .then((data) => {
          setFetchId((prev) => {
            if (prev !== id) return prev
            if (data.error) {
              setErrorText(data.error)
              setPageState('error')
            } else {
              setGames(data.games || [])
              setGamesTotal(data.total || 0)
              setPageState('ready')
            }
            return prev
          })
        })
        .catch(() => {
          setErrorText('Не удалось загрузить каталог игр')
          setPageState('error')
        })
    }, q ? 300 : 0)

    return () => clearTimeout(timer)
  }, [search])

  // ---- Editions fetch (when game selected) ----
  useEffect(() => {
    if (!selectedGame) { setEditions([]); setSelectedEdition(null); return }
    setEditionsLoading(true)
    setSelectedEdition(null)
    fetch(`/api/dessly/games/${selectedGame.app_id}?region=${encodeURIComponent(region)}`)
      .then((r) => r.json())
      .then((data) => {
        // API returns { editions: [...] }
        const list: EditionEntry[] = (data.editions || []).map((e: any) => ({
          edition: e.edition || 'Standard',
          packageId: e.packageId,
          price: e.price || 0,
          priceOriginal: e.priceOriginal || e.price || 0,
          discount: e.discount || 0,
          region: e.region || region,
        }))
        setEditions(list)
        if (list.length > 0) setSelectedEdition(list[0])
      })
      .catch(() => setEditions([]))
      .finally(() => setEditionsLoading(false))
  }, [selectedGame, region])

  // ---- Derived ----
  const inviteValid = isSteamInviteUrl(invite)
  const commissionPct = config?.commission_percent ?? 4
  const editionPriceRub = selectedEdition ? Math.round(selectedEdition.price * 85) : 0 // USD→RUB approx
  const calc = useMemo(
    () => computeGiftTotal(editionPriceRub, commissionPct),
    [editionPriceRub, commissionPct]
  )

  const canSubmit = selectedGame && selectedEdition && inviteValid

  // ---- Submit ----
  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: 'balance',
          items: [{
            product_id: String(selectedGame!.app_id),
            quantity: 1,
            form_data: {
              recipient: invite.trim(),
              region,
              edition: selectedEdition?.edition,
              package_id: String(selectedEdition?.packageId),
            },
          }],
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401) { router.push('/auth/login?redirect=/send-game'); return }
      if (!res.ok) {
        setErrorText(body.error || 'Не удалось оформить отправку')
        setPageState('error')
        return
      }
      setOrderResult(body.order)
      setPageState('success')
    } catch {
      setErrorText('Ошибка сети, повторите попытку')
      setPageState('error')
    } finally {
      setSubmitting(false)
    }
  }

  // ---- Reset for new purchase ----
  const resetAll = () => {
    setSelectedGame(null); setSelectedEdition(null); setEditions([])
    setInvite(''); setStep('game'); setPageState('ready'); setErrorText('')
    setOrderResult(null)
  }

  // ---- Render ----
  return (
    <main className="send-game-root">
      <div className="sg-container">
        {/* Header */}
        <header className="sg-header">
          <h1 className="sg-title">Отправь игру в Steam</h1>
          <p className="sg-subtitle">Подарите игру другу по ссылке-приглашению Steam</p>
        </header>

        {/* Disabled */}
        {config?.enabled === false ? (
          <div className="sg-card sg-card--center">
            <p className="sg-muted">Отправка игр временно недоступна. Загляните позже.</p>
          </div>
        ) : config?.mode === 'embed' && config.widget_url ? (
          /* EMBED mode */
          <div className="sg-card">
            <p className="sg-muted" style={{ marginBottom: 14 }}>
              Откроется готовое окно Dessly с выбором игры, издания, региона и расчётом.
            </p>
            <button onClick={openWidget(config.widget_url, isTelegram)} className="sg-btn sg-btn--primary">
              Открыть окно отправки
            </button>
            {!isTelegram && (
              <iframe
                src={config.widget_url}
                title="Dessly"
                style={{ width: '100%', height: 620, border: 0, borderRadius: 12, marginTop: 16 }}
              />
            )}
          </div>
        ) : (
          /* NATIVE mode */
          <>
            {/* ======== SUCCESS STATE ======== */}
            {pageState === 'success' && orderResult && (
              <div className="sg-success">
                <div className="sg-success-icon">✓</div>
                <h2 className="sg-success-title">Заказ оформлен</h2>
                <p className="sg-success-status">
                  {orderResult.status === 'delivered' ? 'Игра отправлена получателю' : 'Заказ в обработке'}
                </p>
                <p className="sg-success-number">Номер заказа: {orderResult.order_number}</p>
                <button onClick={resetAll} className="sg-btn sg-btn--secondary" style={{ marginTop: 20 }}>
                  Отправить ещё одну игру
                </button>
              </div>
            )}

            {/* ======== ERROR BANNER ======== */}
            {pageState === 'error' && (
              <div className="sg-error-banner">
                <span>{errorText}</span>
                <button onClick={() => { setPageState('ready'); setErrorText('') }} className="sg-error-close">×</button>
              </div>
            )}

            {/* ======== MAIN FLOW ======== */}
            {(pageState === 'loading' || pageState === 'ready') && (
              <>
                {/* Stepper */}
                <Stepper current={step} onStep={(s) => setStep(s)} hasGame={!!selectedGame} hasEdition={!!selectedEdition} />

                {/* STEP 1: Game selection */}
                {step === 'game' && (
                  <div className="sg-card">
                    <div className="sg-search-row">
                      <input
                        className="sg-input sg-search-input"
                        type="text"
                        placeholder="Поиск по названию (Among Us, Counter-Strike, Cyberpunk...)"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>

                    {pageState === 'loading' ? (
                      <SkeletonGrid />
                    ) : games.length === 0 ? (
                      <div className="sg-empty">
                        <span className="sg-empty-icon">🎮</span>
                        <p>{search ? 'Ничего не найдено. Попробуйте другой запрос.' : 'Игры не найдены'}</p>
                      </div>
                    ) : (
                      <>
                        <div className="sg-games-meta">
                          {search
                            ? `Найдено: ${gamesTotal}`
                            : `Показаны первые ${games.length} из ${gamesTotal} игр`}
                        </div>
                        <div className="sg-game-grid">
                          {games.map((game) => (
                            <GameCard
                              key={game.app_id}
                              game={game}
                              selected={selectedGame?.app_id === game.app_id}
                              onSelect={() => { setSelectedGame(game); setStep('details') }}
                            />
                          ))}
                        </div>
                        {games.length < gamesTotal && (
                          <p className="sg-games-hint">
                            Показаны первые {games.length} из {gamesTotal}. Введите поиск чтобы найти нужную игру.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* STEP 2: Details */}
                {step === 'details' && selectedGame && (
                  <div className="sg-card">
                    {/* Selected game chip */}
                    <div className="sg-chosen-game">
                      <div className="sg-chosen-thumb">
                        <GameThumb src={selectedGame.image_url} name={selectedGame.name} aspect />
                      </div>
                      <div className="sg-chosen-info">
                        <div className="sg-chosen-name">{selectedGame.name}</div>
                        <button onClick={() => setStep('game')} className="sg-link-btn">Изменить</button>
                      </div>
                    </div>

                    <div className="sg-details-grid">
                      {/* Region */}
                      <label className="sg-field">
                        <span className="sg-label">Регион аккаунта получателя</span>
                        <div className="sg-region-select">
                          {(config?.regions || ['RU', 'KZ', 'UA', 'TR', 'CN', 'KR', 'ID', 'VN', 'IN']).map((r) => (
                            <button
                              key={r}
                              onClick={() => setRegion(r)}
                              className={`sg-region-chip ${region === r ? 'sg-region-chip--active' : ''}`}
                            >
                              <Flag code={r} className="sg-region-flag" />
                              <span className="sg-region-code">{r}</span>
                              <span className="sg-region-name">{REGION_NAMES[r] || ''}</span>
                            </button>
                          ))}
                        </div>
                      </label>

                      {/* Edition */}
                      <label className="sg-field">
                        <span className="sg-label">Издание</span>
                        {editionsLoading ? (
                          <div className="sg-edition-loading">Загрузка изданий...</div>
                        ) : editions.length === 0 ? (
                          <div className="sg-edition-empty">Нет доступных изданий для {region}</div>
                        ) : (
                          <div className="sg-edition-list">
                            {editions.map((ed) => (
                              <button
                                key={ed.packageId}
                                onClick={() => setSelectedEdition(ed)}
                                className={`sg-edition-chip ${selectedEdition?.packageId === ed.packageId ? 'sg-edition-chip--active' : ''}`}
                              >
                                <span className="sg-edition-name">{ed.edition}</span>
                                <span className="sg-edition-price">~{Math.round(ed.price * 85)} ₽</span>
                                {ed.discount > 0 && (
                                  <span className="sg-edition-badge">-{ed.discount}%</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </label>

                      {/* Invite URL */}
                      <label className="sg-field">
                        <span className="sg-label">Ссылка-приглашение Steam</span>
                        <input
                          className="sg-input"
                          type="text"
                          placeholder="https://s.team/p/xxxx-xxxx"
                          value={invite}
                          onChange={(e) => setInvite(e.target.value)}
                        />
                        {invite && !inviteValid && (
                          <span className="sg-field-error">
                            Формат: https://s.team/p/... или steamcommunity.com/p/...
                          </span>
                        )}
                      </label>

                      {/* Help */}
                      <details className="sg-help">
                        <summary>Как получить ссылку-приглашение?</summary>
                        <ol>
                          <li>Откройте Steam → «Друзья» → «Добавить друга».</li>
                          <li>Нажмите «Скопировать ссылку» под вашим QR-кодом.</li>
                          <li>Вставьте ссылку вида https://s.team/p/... в поле выше.</li>
                        </ol>
                      </details>
                    </div>

                    <button
                      onClick={() => setStep('confirm')}
                      disabled={!inviteValid || !selectedEdition}
                      className="sg-btn sg-btn--primary sg-btn--full"
                      style={{ marginTop: 20 }}
                    >
                      Продолжить
                    </button>
                  </div>
                )}

                {/* STEP 3: Confirm */}
                {step === 'confirm' && selectedGame && selectedEdition && (
                  <div className="sg-card">
                    <h3 className="sg-step-title">Подтверждение заказа</h3>

                    <div className="sg-confirm-rows">
                      <div className="sg-confirm-row">
                        <span>Игра</span>
                        <span className="sg-confirm-val">{selectedGame.name}</span>
                      </div>
                      <div className="sg-confirm-row">
                        <span>Издание</span>
                        <span className="sg-confirm-val">{selectedEdition.edition}</span>
                      </div>
                      <div className="sg-confirm-row">
                        <span>Регион</span>
                        <span className="sg-confirm-val sg-confirm-region">
                          <Flag code={region} className="sg-region-flag" />
                          {region} — {REGION_NAMES[region] || ''}
                        </span>
                      </div>
                      <div className="sg-confirm-row">
                        <span>Получатель</span>
                        <span className="sg-confirm-val" style={{ fontSize: 12, wordBreak: 'break-all' }}>{invite}</span>
                      </div>
                      <div className="sg-confirm-divider" />
                      <div className="sg-confirm-row">
                        <span>Цена игры</span>
                        <span className="sg-confirm-val">{calc.price} ₽</span>
                      </div>
                      <div className="sg-confirm-row">
                        <span>Комиссия ({commissionPct}%)</span>
                        <span className="sg-confirm-val">{calc.commission} ₽</span>
                      </div>
                      <div className="sg-confirm-row sg-confirm-row--total">
                        <span>К оплате</span>
                        <span className="sg-confirm-total">{calc.total} ₽</span>
                      </div>
                    </div>

                    <p className="sg-confirm-note">
                      Точная цена определяется поставщиком при отправке и может незначительно отличаться.
                    </p>

                    <button
                      onClick={submit}
                      disabled={submitting || !canSubmit}
                      className="sg-btn sg-btn--primary sg-btn--full sg-btn--lg"
                    >
                      {submitting ? 'Оформляем...' : `Оплатить с баланса · ${calc.total} ₽`}
                    </button>

                    <p className="sg-confirm-terms">
                      Нажимая «Оплатить с баланса», вы принимаете{' '}
                      <Link href="/offer">условия оферты</Link>.
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <style jsx>{SEND_GAME_CSS}</style>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function openWidget(url: string, isTelegram: boolean) {
  return () => {
    const tg = (window as any).Telegram?.WebApp
    if (isTelegram && tg?.openLink) tg.openLink(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Кросс-платформенный флаг страны. Эмодзи-флаги не отображаются на Windows
 * (вместо 🇷🇺 видно «RU»), поэтому рисуем картинку. Основной CDN — flagcdn;
 * при сбое (блокировка/нет сети) пробуем flagsapi, затем fallback-код в рамке.
 */
function Flag({ code, className }: { code: string; className?: string }) {
  const [attempt, setAttempt] = useState(0) // 0=flagcdn, 1=flagsapi, 2=fallback
  const cc = REGION_CC[code]
  if (!cc || attempt >= 2) {
    return <span className={`sg-flag-fallback ${className || ''}`.trim()}>{code}</span>
  }
  const src =
    attempt === 0
      ? `https://flagcdn.com/w40/${cc}.png`
      : `https://flagsapi.com/${cc.toUpperCase()}/flat/32.png`
  const srcSet = attempt === 0
    ? `https://flagcdn.com/w80/${cc}.png 2x`
    : undefined
  return (
    <img
      className={`sg-flag-img ${className || ''}`.trim()}
      src={src}
      srcSet={srcSet}
      alt={code}
      width={20}
      height={15}
      loading="lazy"
      onError={() => setAttempt((a) => a + 1)}
    />
  )
}

/** Step indicator bar */
function Stepper({
  current, onStep, hasGame, hasEdition,
}: {
  current: Step; onStep: (s: Step) => void; hasGame: boolean; hasEdition: boolean;
}) {
  const steps: { key: Step; num: number; label: string }[] = [
    { key: 'game', num: 1, label: 'Выбор игры' },
    { key: 'details', num: 2, label: 'Данные отправки' },
    { key: 'confirm', num: 3, label: 'Подтверждение' },
  ]

  const enabled = (s: Step) => {
    if (s === 'game') return true
    if (s === 'details') return hasGame
    if (s === 'confirm') return hasGame && hasEdition
    return false
  }

  return (
    <div className="sg-stepper">
      {steps.map((s, i) => {
        const isActive = current === s.key
        const isDone = (
          (s.key === 'game' && (hasGame)) ||
          (s.key === 'details' && (hasGame && hasEdition && current === 'confirm')) ||
          (s.key === 'confirm' && current === 'confirm' && hasEdition)
        )
        const clickable = enabled(s.key)

        return (
          <div key={s.key} className="sg-step-row">
            {i > 0 && <div className={`sg-step-line ${isDone ? 'sg-step-line--done' : ''}`} />}
            <button
              onClick={() => clickable && onStep(s.key)}
              disabled={!clickable}
              className={`sg-step-bubble ${isActive ? 'sg-step-bubble--active' : ''} ${isDone ? 'sg-step-bubble--done' : ''}`}
            >
              {isDone ? '✓' : s.num}
            </button>
            <span className={`sg-step-label ${isActive ? 'sg-step-label--active' : ''}`}>
              {s.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Single game card in the grid */
function GameCard({ game, selected, onSelect }: { game: GameEntry; selected: boolean; onSelect: () => void }) {
  const [imgErr, setImgErr] = useState(false)

  return (
    <button
      onClick={onSelect}
      className={`sg-game-card ${selected ? 'sg-game-card--selected' : ''}`}
    >
      <GameThumb
        src={imgErr ? null : game.image_url}
        name={game.name}
        onError={() => setImgErr(true)}
        aspect
      />
      <span className="sg-game-name">
        {game.popular && <span className="sg-game-star">★ </span>}
        {game.name}
      </span>
    </button>
  )
}

/** Game thumbnail image with letter fallback */
function GameThumb({
  src, name, size, aspect, onError,
}: {
  src: string | null; name: string; size?: number; aspect?: boolean; onError?: () => void;
}) {
  const [err, setErr] = useState(false)

  if (!src || err) {
    const letter = (name || '?')[0].toUpperCase()
    const hue = (name || 'a').charCodeAt(0) * 37 % 360
    const dim = size || '100%'
    return (
      <div
        className="sg-thumb-fallback"
        style={{
          width: typeof dim === 'number' ? dim : undefined,
          height: typeof dim === 'number' ? dim : undefined,
          aspectRatio: aspect ? '460 / 215' : undefined,
          background: `linear-gradient(135deg, hsl(${hue},50%,40%), hsl(${hue},40%,25%))`,
          fontSize: typeof dim === 'number' ? dim * 0.45 : 28,
        }}
      >
        {letter}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => { setErr(true); onError?.() }}
      className="sg-thumb-img"
      style={{ aspectRatio: aspect ? '460/215' : undefined }}
    />
  )
}

/** Skeleton placeholder grid */
function SkeletonGrid() {
  return (
    <div className="sg-skeleton-grid">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="sg-skeleton-card">
          <div className="sg-skeleton-img" />
          <div className="sg-skeleton-line" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles (CSS-in-JS via <style jsx>)
// ---------------------------------------------------------------------------

const SEND_GAME_CSS = `
  /* ---- Root ---- */
  .send-game-root { min-height: 60vh; padding: 32px 0 64px; }
  .sg-container { max-width: 900px; margin: 0 auto; padding: 0 16px; }

  /* ---- Header ---- */
  .sg-header { margin-bottom: 24px; }
  .sg-title { font-size: 22px; font-weight: 800; color: var(--navy, #0f1e2e); margin: 0 0 6px; letter-spacing: -0.01em; }
  .sg-subtitle { color: var(--muted, #5b6472); margin: 0; font-size: 14px; }
  @media (min-width: 601px) {
    .sg-title { font-size: 28px; }
    .sg-subtitle { font-size: 15px; }
  }

  /* ---- Card ---- */
  .sg-card { background: var(--surface, #fff); border: 1px solid var(--border, #e6eaf0); border-radius: 14px; padding: 24px; }
  .sg-card--center { text-align: center; padding: 40px 24px; }
  .sg-muted { color: var(--muted, #5b6472); margin: 0; }

  /* ---- Buttons ---- */
  .sg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: none; border-radius: 10px;
    font-weight: 600; font-size: 15px; cursor: pointer; padding: 10px 24px; min-height: 44px;
    transition: all 0.15s; }
  .sg-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sg-btn--primary { background: var(--blue, #1c8ce3); color: #fff; }
  .sg-btn--primary:hover:not(:disabled) { background: var(--blue-600, #1577c7); }
  .sg-btn--secondary { background: var(--blue-50, #eaf4fd); color: var(--blue-700, #0f62a8); }
  .sg-btn--secondary:hover:not(:disabled) { background: var(--blue-100, #d6eafb); }
  .sg-btn--full { width: 100%; }
  .sg-btn--lg { padding: 14px 24px; font-size: 16px; }
  .sg-link-btn { background: none; border: none; color: var(--blue, #1c8ce3); cursor: pointer; font-size: 13px; padding: 0; }
  .sg-link-btn:hover { text-decoration: underline; }

  /* ---- Input ---- */
  .sg-input { width: 100%; padding: 10px 14px; border: 1px solid var(--border, #e6eaf0); border-radius: 10px;
    font-size: 14px; color: var(--ink, #10202e); background: var(--surface, #fff); outline: none;
    transition: border-color 0.15s; min-height: 44px; box-sizing: border-box; }
  .sg-input:focus { border-color: var(--blue-200, #bfddf7); box-shadow: 0 0 0 3px rgba(28,140,227,0.1); }
  .sg-input::placeholder { color: var(--muted-2, #869099); }

  /* ---- Stepper ---- */
  .sg-stepper { display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 20px;
    padding: 12px 16px; background: var(--surface, #fff); border: 1px solid var(--border, #e6eaf0);
    border-radius: 14px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .sg-step-row { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .sg-step-line { width: 20px; height: 2px; background: var(--border, #e6eaf0); border-radius: 1px; margin: 0 4px; flex: none; }
  .sg-step-line--done { background: var(--blue, #1c8ce3); }
  .sg-step-bubble { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; border: 2px solid var(--border, #e6eaf0); background: #fff; color: var(--muted-2);
    cursor: pointer; transition: all 0.15s; flex-shrink: 0; padding: 0; }
  .sg-step-bubble:disabled { cursor: default; }
  .sg-step-bubble--active { border-color: var(--blue, #1c8ce3); background: var(--blue, #1c8ce3); color: #fff; }
  .sg-step-bubble--done { border-color: var(--green, #15a05a); background: var(--green, #15a05a); color: #fff; }
  .sg-step-label { font-size: 12px; color: var(--muted-2, #869099); white-space: nowrap; }
  .sg-step-label--active { color: var(--navy, #0f1e2e); font-weight: 600; }

  /* ---- Search ---- */
  .sg-search-row { margin-bottom: 16px; }
  .sg-search-input { font-size: 14px; }
  @media (min-width: 601px) {
    .sg-search-input { font-size: 15px; }
  }

  /* ---- Game Grid ---- */
  .sg-games-meta { font-size: 12px; color: var(--muted-2, #869099); margin-bottom: 12px; }
  .sg-game-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(114px, 1fr)); gap: 8px;
    max-height: 420px; overflow-y: auto; padding: 2px; -webkit-overflow-scrolling: touch; }
  @media (min-width: 500px) {
    .sg-game-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; max-height: 460px; }
  }
  .sg-games-hint { font-size: 12px; color: var(--muted-2); text-align: center; margin-top: 12px; }

  .sg-game-card { display: flex; flex-direction: column; border: 1.5px solid var(--border, #e6eaf0);
    border-radius: 10px; overflow: hidden; cursor: pointer; background: #fff; transition: all 0.15s;
    text-align: left; padding: 0; min-height: 44px; }
  .sg-game-card:hover { border-color: var(--blue-200, #bfddf7); background: #fafcff; }
  .sg-game-card--selected { border-color: var(--blue, #1c8ce3); background: var(--blue-50, #eaf4fd); }
  .sg-game-name { padding: 6px 8px 8px; font-size: 12px; font-weight: 600; color: var(--ink, #10202e);
    line-height: 1.3; word-break: break-word; }
  .sg-game-star { color: var(--amber, #c9821a); }

  /* ---- Thumb ---- */
  .sg-thumb-img { width: 100%; height: auto; display: block; object-fit: cover; background: #eef2f8; }
  .sg-thumb-fallback { display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; }

  /* ---- Skeleton ---- */
  .sg-skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(114px, 1fr)); gap: 8px; }
  @media (min-width: 500px) {
    .sg-skeleton-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  }
  .sg-skeleton-card { border-radius: 10px; overflow: hidden; border: 1px solid var(--border-2, #edf1f6); }
  .sg-skeleton-img { aspect-ratio: 460 / 215; background: linear-gradient(90deg, #eef2f8 25%, #f4f7fa 50%, #eef2f8 75%);
    background-size: 200% 100%; animation: sg-shimmer 1.5s infinite; }
  .sg-skeleton-line { height: 14px; margin: 8px; border-radius: 4px;
    background: linear-gradient(90deg, #eef2f8 25%, #f4f7fa 50%, #eef2f8 75%);
    background-size: 200% 100%; animation: sg-shimmer 1.5s infinite; }
  @keyframes sg-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* ---- Empty ---- */
  .sg-empty { text-align: center; padding: 48px 16px; color: var(--muted, #5b6472); }
  .sg-empty-icon { font-size: 40px; display: block; margin-bottom: 12px; }

  /* ---- Success ---- */
  .sg-success { text-align: center; padding: 48px 24px; background: var(--surface, #fff);
    border: 1px solid var(--border, #e6eaf0); border-radius: 14px; }
  .sg-success-icon { width: 64px; height: 64px; border-radius: 50%; background: var(--green-bg, #e7f6ed);
    color: var(--green, #15a05a); display: flex; align-items: center; justify-content: center;
    font-size: 30px; font-weight: 800; margin: 0 auto 16px; }
  .sg-success-title { font-size: 22px; font-weight: 800; color: var(--navy, #0f1e2e); margin: 0 0 8px; }
  .sg-success-status { color: var(--green, #15a05a); font-weight: 600; margin: 0 0 4px; }
  .sg-success-number { color: var(--muted, #5b6472); font-size: 14px; margin: 0; }

  /* ---- Error ---- */
  .sg-error-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 16px; background: var(--red-bg, #fbeaea); color: var(--red, #d63b3b);
    border-radius: 10px; margin-bottom: 16px; font-size: 14px; }
  .sg-error-close { background: none; border: none; color: inherit; font-size: 20px; cursor: pointer; padding: 0 4px; line-height: 1; }

  /* ---- Step 2: chosen game ---- */
  .sg-chosen-game { display: flex; align-items: center; gap: 12px; padding: 12px;
    background: var(--blue-50, #eaf4fd); border-radius: 12px; margin-bottom: 20px; }
  .sg-chosen-thumb { flex: none; width: 96px; border-radius: 8px; overflow: hidden; }
  .sg-chosen-thumb :global(.sg-thumb-img),
  .sg-chosen-thumb :global(.sg-thumb-fallback) { border-radius: 8px; }
  .sg-chosen-info { min-width: 0; flex: 1; }
  .sg-chosen-name { font-weight: 700; color: var(--navy, #0f1e2e); font-size: 15px; margin-bottom: 2px; }

  .sg-details-grid { display: grid; gap: 16px; }
  .sg-field { display: grid; gap: 6px; }
  .sg-label { font-weight: 600; color: var(--navy, #0f1e2e); font-size: 14px; }
  .sg-field-error { color: var(--red, #d63b3b); font-size: 12px; }

  /* ---- Region chips ---- */
  .sg-region-select { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }
  @media (min-width: 900px) {
    .sg-region-select { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  }
  .sg-region-chip { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
    border: 1.5px solid var(--border, #e6eaf0); border-radius: 10px; background: #fff;
    cursor: pointer; transition: all 0.15s; font-size: 12px; min-height: 44px; text-align: left; }
  @media (min-width: 601px) {
    .sg-region-chip { gap: 8px; padding: 8px 12px; font-size: 13px; }
  }
  .sg-region-chip:hover { border-color: var(--blue-200, #bfddf7); }
  .sg-region-chip--active { border-color: var(--blue, #1c8ce3); background: var(--blue-50, #eaf4fd); }
  .sg-region-code { font-weight: 700; color: var(--navy, #0f1e2e); flex: none; }
  .sg-region-name { color: var(--muted, #5b6472); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  @media (min-width: 601px) {
    .sg-region-name { font-size: 13px; }
  }

  /* ---- Flags (cross-platform images instead of emoji) ---- */
  .sg-flag-img { width: 22px; height: 16px; border-radius: 3px; object-fit: cover; flex: none;
    box-shadow: 0 0 0 1px rgba(16,32,46,0.08); display: block; }
  .sg-flag-fallback { display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 16px; border-radius: 3px; background: var(--gray-bg, #eff2f5);
    font-size: 8px; font-weight: 800; color: var(--muted, #5b6472); flex: none;
    box-shadow: 0 0 0 1px rgba(16,32,46,0.08); }

  /* ---- Edition chips ---- */
  .sg-edition-loading, .sg-edition-empty { font-size: 13px; color: var(--muted, #5b6472); padding: 8px 0; }
  .sg-edition-list { display: flex; flex-direction: column; gap: 8px; }
  .sg-edition-chip { display: flex; align-items: center; gap: 10px; padding: 12px 14px; width: 100%;
    border: 1.5px solid var(--border, #e6eaf0); border-radius: 10px; background: #fff;
    cursor: pointer; transition: all 0.15s; min-height: 44px; text-align: left; }
  .sg-edition-chip:hover { border-color: var(--blue-200); }
  .sg-edition-chip--active { border-color: var(--blue, #1c8ce3); background: var(--blue-50, #eaf4fd); }
  .sg-edition-name { flex: 1; min-width: 0; font-weight: 600; color: var(--navy, #0f1e2e); font-size: 14px; }
  .sg-edition-price { flex: none; color: var(--navy, #0f1e2e); font-size: 14px; font-weight: 700; white-space: nowrap; }
  .sg-edition-badge { flex: none; background: var(--green-bg, #e7f6ed); color: var(--green, #15a05a);
    padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; }

  /* ---- Help ---- */
  .sg-help { background: var(--blue-50, #eaf4fd); border-radius: 10px; padding: 10px 14px;
    border: 1px solid var(--blue-100, #d6eafb); cursor: pointer; font-size: 13px; }
  .sg-help summary { font-weight: 600; color: var(--blue-700, #0f62a8); }
  .sg-help ol { margin: 8px 0 0; padding-left: 16px; color: var(--muted, #5b6472); line-height: 1.6; }

  /* ---- Confirm ---- */
  .sg-step-title { font-size: 18px; font-weight: 700; color: var(--navy, #0f1e2e); margin: 0 0 16px; }
  .sg-confirm-rows { display: grid; gap: 10px; }
  .sg-confirm-row { display: flex; justify-content: space-between; align-items: center;
    font-size: 14px; color: var(--muted, #5b6472); }
  .sg-confirm-val { font-weight: 600; color: var(--ink, #10202e); text-align: right; }
  .sg-confirm-region { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .sg-confirm-divider { height: 1px; background: var(--border, #e6eaf0); margin: 4px 0; }
  .sg-confirm-row--total { font-size: 16px; font-weight: 700; color: var(--navy, #0f1e2e); }
  .sg-confirm-total { font-size: 20px; font-weight: 800; color: var(--navy, #0f1e2e); }
  .sg-confirm-note { font-size: 12px; color: var(--muted-2, #869099); margin: 12px 0 0; }
  .sg-confirm-terms { font-size: 12px; color: var(--muted-2, #869099); text-align: center; margin-top: 12px; }

  /* ---- Responsive ---- */
  @media (max-width: 600px) {
    .send-game-root { padding: 12px 0 48px; }
    .sg-container { padding: 0 10px; }
    .sg-header { margin-bottom: 14px; }
    .sg-card { padding: 14px 12px; border-radius: 12px; }
    .sg-stepper { padding: 8px 10px; }
    .sg-step-label { display: none; }
    .sg-step-row { gap: 0; }
    .sg-step-line { width: 12px; margin: 0 3px; }
    .sg-step-bubble { width: 24px; height: 24px; font-size: 10px; }
    .sg-game-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; max-height: 340px; }
    .sg-skeleton-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; }
    .sg-region-select { grid-template-columns: 1fr 1fr; gap: 5px; }
    .sg-region-chip { padding: 7px 8px; gap: 5px; min-height: 40px; }
    .sg-region-name { font-size: 11px; }
    .sg-region-code { font-size: 11px; }
    .sg-flag-img { width: 18px; height: 13px; }
    .sg-flag-fallback { width: 18px; height: 13px; font-size: 7px; }
    .sg-chosen-thumb { width: 64px; }
    .sg-chosen-game { gap: 8px; padding: 10px; }
    .sg-chosen-name { font-size: 13px; }
    .sg-edition-chip { padding: 10px 12px; }
    .sg-edition-name { font-size: 13px; }
    .sg-edition-price { font-size: 13px; }
    .sg-details-grid { gap: 12px; }
    .sg-confirm-row { font-size: 13px; }
    .sg-confirm-total { font-size: 18px; }
    .sg-btn { font-size: 14px; padding: 9px 18px; min-height: 40px; }
    .sg-btn--lg { padding: 12px 20px; font-size: 15px; }
    .sg-step-title { font-size: 16px; }
  }
  @media (max-width: 380px) {
    .sg-container { padding: 0 8px; }
    .sg-card { padding: 12px 10px; }
    .sg-game-grid { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 5px; max-height: 300px; }
    .sg-region-select { grid-template-columns: 1fr; gap: 5px; }
    .sg-game-name { font-size: 11px; padding: 5px 6px 7px; }
    .sg-game-card { border-radius: 8px; }
  }

  /* ---- Mini App ---- */
  html.tg-webapp .send-game-root { padding-top: 4px; padding-bottom: 32px; }
  html.tg-webapp .sg-container { padding-left: 8px; padding-right: 8px; }
  html.tg-webapp .sg-game-grid { max-height: 280px; }
  html.tg-webapp .sg-header { margin-bottom: 10px; }
  html.tg-webapp .sg-title { font-size: 20px; }
  html.tg-webapp .sg-stepper { margin-bottom: 12px; }
  html.tg-webapp .sg-card { padding: 12px 10px; }
`
