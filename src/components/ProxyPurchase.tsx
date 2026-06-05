'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/**
 * Блок «Купить прокси» на главной — БОЕВАЯ покупка через px6 (proxy6).
 *
 * Поток (всё считается/проводится на сервере, фронту не доверяем цену):
 *   1) GET /api/proxy/config?version= — версии, сроки, лимиты, флаг включения, страны под версию.
 *   2) GET /api/proxy/price — динамический пересчёт итоговой цены ₽ (debounce) + наличие (getCount).
 *   3) POST /api/proxy/buy — холд→покупка→выдача с idempotency_key (повторный клик не купит дважды).
 *
 * Состояния: загрузка / нет в наличии / ошибка / успех (показ прокси + копирование).
 * Light-тема (токены NiceTry), адаптив, работает в Mini App. Скрывается, если покупка выключена
 * в админке (proxy_settings.is_enabled = false).
 */

interface VersionOpt {
  value: number
  label: string
}

interface ProxyConfig {
  enabled: boolean
  versions: VersionOpt[]
  periods: number[]
  max_count: number
  countries?: string[]
}

interface PriceInfo {
  inStock: boolean
  available: number
  price: number | null
  price_single?: number | null
  error?: string
}

/** Один выданный прокси (форма из proxy_orders.proxies / ответа buy — Px6Proxy, camelCase). */
interface BoughtProxy {
  id: string
  ip: string
  host: string
  port: string
  user: string
  pass: string
  type: string
  country: string
  date?: string
  dateEnd?: string
  date_end?: string
  active?: boolean
}

// ISO-2 → русское название (частые страны px6); фолбэк — код в верхнем регистре.
const COUNTRY_NAMES: Record<string, string> = {
  ru: 'Россия', us: 'США', gb: 'Великобритания', uk: 'Великобритания', de: 'Германия',
  fr: 'Франция', nl: 'Нидерланды', ua: 'Украина', pl: 'Польша', es: 'Испания',
  it: 'Италия', ca: 'Канада', cn: 'Китай', jp: 'Япония', kz: 'Казахстан',
  tr: 'Турция', in: 'Индия', br: 'Бразилия', se: 'Швеция', fi: 'Финляндия',
  no: 'Норвегия', dk: 'Дания', ch: 'Швейцария', at: 'Австрия', be: 'Бельгия',
  cz: 'Чехия', ro: 'Румыния', pt: 'Португалия', gr: 'Греция', ie: 'Ирландия',
  au: 'Австралия', kr: 'Южная Корея', sg: 'Сингапур', hk: 'Гонконг', il: 'Израиль',
  mx: 'Мексика', ar: 'Аргентина', za: 'ЮАР', ae: 'ОАЭ', id: 'Индонезия',
  vn: 'Вьетнам', th: 'Таиланд', hu: 'Венгрия', bg: 'Болгария', lv: 'Латвия',
  lt: 'Литва', ee: 'Эстония', sk: 'Словакия', rs: 'Сербия', md: 'Молдова',
}

function countryName(code: string): string {
  return COUNTRY_NAMES[code.toLowerCase()] || code.toUpperCase()
}

// Флаг страны (растровый, чтобы одинаково выглядел на всех ОС, как в send-game).
function flagUrl(code: string): string {
  const cc = code.toLowerCase() === 'uk' ? 'gb' : code.toLowerCase()
  return `https://flagcdn.com/w40/${cc}.png`
}

function pluralProxy(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'прокси'
  return 'прокси'
}

function proxyLine(p: BoughtProxy): string {
  const host = p.host || p.ip
  const auth = p.user ? `${p.user}:${p.pass}` : ''
  return auth ? `${host}:${p.port}:${p.user}:${p.pass}` : `${host}:${p.port}`
}

function endDate(p: BoughtProxy): string {
  return p.dateEnd || p.date_end || ''
}

export default function ProxyPurchase({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter()

  const [config, setConfig] = useState<ProxyConfig | null>(null)
  const [configError, setConfigError] = useState(false)

  const [version, setVersion] = useState<number>(3)
  const [countries, setCountries] = useState<string[]>([])
  const [country, setCountry] = useState('')
  const [count, setCount] = useState(1)
  const [period, setPeriod] = useState(0)
  const [protocol, setProtocol] = useState<'http' | 'socks'>('http')

  const [price, setPrice] = useState<PriceInfo | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)

  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState('')
  const [result, setResult] = useState<{ proxies: BoughtProxy[]; price: number } | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Стабильный ключ идемпотентности на текущий выбор: повторный клик не купит дважды.
  // Меняется при смене параметров и после успешной покупки (новая покупка — новый ключ).
  const idemKey = useRef<string>('')
  const newIdemKey = () => {
    idemKey.current =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `px6-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  if (!idemKey.current) newIdemKey()

  // --- Загрузка конфига под версию (версии/сроки/лимиты/страны) ---
  const loadConfig = useCallback((v: number, isFirst: boolean) => {
    fetch(`/api/proxy/config?version=${v}`)
      .then((r) => r.json())
      .then((c: ProxyConfig & { error?: string }) => {
        if (c.error) {
          setConfigError(true)
          return
        }
        if (isFirst) {
          setConfig(c)
          if (c.periods?.length) setPeriod(c.periods.includes(30) ? 30 : c.periods[0])
        }
        const list = c.countries || []
        setCountries(list)
        setCountry((prev) => (prev && list.includes(prev) ? prev : list[0] || ''))
      })
      .catch(() => setConfigError(true))
  }, [])

  useEffect(() => {
    loadConfig(version, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Смена версии → перезагрузка стран под версию.
  const onVersion = (v: number) => {
    setVersion(v)
    setResult(null)
    setBuyError('')
    loadConfig(v, false)
  }

  // --- Динамический расчёт цены (debounce) ---
  useEffect(() => {
    if (!country || !period || count < 1) {
      setPrice(null)
      return
    }
    setPriceLoading(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        version: String(version),
        country,
        count: String(count),
        period: String(period),
      })
      fetch(`/api/proxy/price?${params}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data: PriceInfo & { error?: string }) => {
          if (data.error && data.inStock === undefined) {
            setPrice({ inStock: false, available: 0, price: null, error: data.error })
          } else {
            setPrice({
              inStock: Boolean(data.inStock),
              available: data.available ?? 0,
              price: data.price ?? null,
              price_single: data.price_single ?? null,
              error: data.error,
            })
          }
        })
        .catch((e) => {
          if (e?.name !== 'AbortError') setPrice({ inStock: false, available: 0, price: null, error: 'Не удалось рассчитать цену' })
        })
        .finally(() => setPriceLoading(false))
    }, 350)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [version, country, count, period])

  // Смена параметров → новый ключ идемпотентности + сброс прошлого результата.
  useEffect(() => {
    newIdemKey()
    setResult(null)
    setBuyError('')
  }, [version, country, count, period, protocol])

  const maxCount = config?.max_count ?? 50
  const canBuy =
    !buying && !priceLoading && !!country && !!period && count >= 1 && count <= maxCount &&
    price?.inStock === true && (price?.price ?? 0) > 0

  const buy = async () => {
    if (!canBuy) return
    setBuying(true)
    setBuyError('')
    try {
      const res = await fetch('/api/proxy/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          country,
          count,
          period,
          type: version === 5 ? undefined : protocol,
          idempotency_key: idemKey.current,
        }),
      })
      if (res.status === 401) {
        router.push('/auth/login?redirect=/')
        return
      }
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.success) {
        setBuyError(body.error || 'Не удалось купить прокси')
        return
      }
      setResult({ proxies: body.proxies || [], price: Number(body.price) || 0 })
      newIdemKey() // следующая покупка — новый ключ
    } catch {
      setBuyError('Ошибка сети, повторите попытку')
    } finally {
      setBuying(false)
    }
  }

  const copyOne = (p: BoughtProxy) => {
    navigator.clipboard.writeText(proxyLine(p)).then(() => {
      setCopiedId(p.id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  const copyAll = () => {
    if (!result) return
    const text = result.proxies.map(proxyLine).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1800)
    })
  }

  const versions = useMemo(() => config?.versions || [], [config])
  const periods = config?.periods || []

  // Покупка прокси выключена в админке — не показываем блок вовсе.
  if (config && config.enabled === false) return null
  // Конфиг не загрузился (нет настроек/ошибка) — тихо скрываем, чтобы не ломать главную.
  if (configError && !config) return null

  return (
    <section className={`px6${embedded ? ' px6--embedded' : ''}`}>
      <div className="px6-card">
        {!embedded && (
          <header className="px6-head">
            <div className="px6-head-ic" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
              </svg>
            </div>
            <div className="px6-head-txt">
              <h2 className="px6-title">Купить прокси</h2>
              <p className="px6-sub">IPv4 / IPv6 прокси под любую страну — выдача за секунды.</p>
            </div>
          </header>
        )}

        {!config ? (
          <div className="px6-skel">
            <div className="px6-skel-row" />
            <div className="px6-skel-row" />
            <div className="px6-skel-row" style={{ width: '60%' }} />
          </div>
        ) : result ? (
          /* ======== УСПЕХ ======== */
          <div className="px6-success">
            <div className="px6-success-top">
              <span className="px6-success-ic">✓</span>
              <div>
                <div className="px6-success-title">Прокси куплены</div>
                <div className="px6-success-sub">
                  {result.proxies.length} {pluralProxy(result.proxies.length)} · списано {result.price} ₽
                </div>
              </div>
              <button className="px6-btn px6-btn--ghost px6-copyall" onClick={copyAll}>
                {copiedAll ? '✓ Скопировано' : 'Копировать все'}
              </button>
            </div>

            <div className="px6-proxy-list">
              {result.proxies.map((p) => (
                <div key={p.id} className="px6-proxy-row">
                  <code className="px6-proxy-line">{proxyLine(p)}</code>
                  <div className="px6-proxy-meta">
                    <span className="px6-chip">{(p.type || 'http').toUpperCase()}</span>
                    {p.country && <span className="px6-chip">{p.country.toUpperCase()}</span>}
                    {endDate(p) && <span className="px6-proxy-end">до {endDate(p)}</span>}
                  </div>
                  <button className="px6-btn px6-btn--ghost px6-copyone" onClick={() => copyOne(p)}>
                    {copiedId === p.id ? '✓' : 'Копировать'}
                  </button>
                </div>
              ))}
            </div>

            <div className="px6-success-actions">
              <button className="px6-btn px6-btn--secondary" onClick={() => setResult(null)}>
                Купить ещё
              </button>
              <Link href="/profile" className="px6-btn px6-btn--ghost">
                Мои прокси в профиле →
              </Link>
            </div>
          </div>
        ) : (
          /* ======== ФОРМА ПОКУПКИ ======== */
          <>
            <div className="px6-grid">
              {/* Версия / тип прокси */}
              <div className="px6-field">
                <span className="px6-label">Тип прокси</span>
                <div className="px6-chips">
                  {versions.map((v) => (
                    <button
                      key={v.value}
                      className={`px6-opt ${version === v.value ? 'px6-opt--active' : ''}`}
                      onClick={() => onVersion(v.value)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Протокол (для не-MTProto) */}
              {version !== 5 && (
                <div className="px6-field">
                  <span className="px6-label">Протокол</span>
                  <div className="px6-chips">
                    {(['http', 'socks'] as const).map((pr) => (
                      <button
                        key={pr}
                        className={`px6-opt ${protocol === pr ? 'px6-opt--active' : ''}`}
                        onClick={() => setProtocol(pr)}
                      >
                        {pr === 'http' ? 'HTTP(S)' : 'SOCKS5'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Страна */}
              <div className="px6-field">
                <span className="px6-label">Страна</span>
                {countries.length === 0 ? (
                  <div className="px6-muted">Загрузка стран…</div>
                ) : (
                  <div className="px6-country-wrap">
                    {country && (
                      <img className="px6-flag" src={flagUrl(country)} alt="" width={22} height={16} loading="lazy" />
                    )}
                    <select
                      className="px6-select"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      aria-label="Страна прокси"
                    >
                      {countries.map((c) => (
                        <option key={c} value={c}>
                          {countryName(c)} ({c.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Количество */}
              <div className="px6-field">
                <span className="px6-label">Количество (макс. {maxCount})</span>
                <div className="px6-stepper">
                  <button className="px6-step-btn" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="Меньше">−</button>
                  <input
                    className="px6-count-input"
                    type="number"
                    min={1}
                    max={maxCount}
                    value={count}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      setCount(Number.isFinite(n) ? Math.min(Math.max(n, 1), maxCount) : 1)
                    }}
                  />
                  <button className="px6-step-btn" onClick={() => setCount((c) => Math.min(maxCount, c + 1))} aria-label="Больше">+</button>
                </div>
              </div>

              {/* Срок */}
              <div className="px6-field px6-field--wide">
                <span className="px6-label">Срок аренды (дней)</span>
                <div className="px6-chips">
                  {periods.map((d) => (
                    <button
                      key={d}
                      className={`px6-opt ${period === d ? 'px6-opt--active' : ''}`}
                      onClick={() => setPeriod(d)}
                    >
                      {d} дн.
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Цена + покупка */}
            <div className="px6-footer">
              <div className="px6-price-box">
                {priceLoading ? (
                  <span className="px6-price-loading">Считаем цену…</span>
                ) : price?.error ? (
                  <span className="px6-price-err">{price.error}</span>
                ) : price?.inStock && price.price ? (
                  <>
                    <span className="px6-price-total">{price.price} ₽</span>
                    {price.price_single ? (
                      <span className="px6-price-single">≈ {price.price_single} ₽ за прокси · в наличии {price.available}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="px6-muted">Выберите параметры</span>
                )}
              </div>

              <button className="px6-btn px6-btn--primary px6-buy" onClick={buy} disabled={!canBuy}>
                {buying ? 'Покупаем…' : price?.price ? `Купить · ${price.price} ₽` : 'Купить'}
              </button>
            </div>

            {buyError && <div className="px6-error">{buyError}</div>}
            <p className="px6-terms">
              Оплата спишется с баланса. Нажимая «Купить», вы принимаете <Link href="/offer">условия оферты</Link>.
            </p>
          </>
        )}
      </div>

      <style jsx>{PX6_CSS}</style>
    </section>
  )
}

const PX6_CSS = `
  .px6 { margin: 0 0 30px; }
  .px6-card { background: var(--surface, #fff); border: 1px solid var(--border, #e6eaf0);
    border-radius: 16px; padding: 22px; }

  /* В модалке шапку/рамку/отступ даёт само окно — карточка становится «прозрачной». */
  .px6--embedded { margin: 0; }
  .px6--embedded .px6-card { border: none; border-radius: 0; padding: 0; background: transparent; }

  .px6-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
  .px6-head-ic { flex: none; width: 46px; height: 46px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    background: var(--blue-50, #eaf4fd); color: var(--blue, #1c8ce3); }
  .px6-title { font-size: 20px; font-weight: 800; color: var(--navy, #0f1e2e); margin: 0; letter-spacing: -0.01em; }
  .px6-sub { color: var(--muted, #5b6472); margin: 2px 0 0; font-size: 13.5px; }

  /* Skeleton */
  .px6-skel { display: grid; gap: 12px; }
  .px6-skel-row { height: 40px; border-radius: 10px;
    background: linear-gradient(90deg, #eef2f8 25%, #f4f7fa 50%, #eef2f8 75%);
    background-size: 200% 100%; animation: px6-shimmer 1.5s infinite; }
  @keyframes px6-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* Form grid */
  .px6-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .px6-field { display: grid; gap: 7px; align-content: start; }
  .px6-field--wide { grid-column: 1 / -1; }
  .px6-label { font-weight: 600; color: var(--navy, #0f1e2e); font-size: 13.5px; }
  .px6-muted { color: var(--muted, #5b6472); font-size: 13px; }

  .px6-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .px6-opt { padding: 9px 14px; border: 1.5px solid var(--border, #e6eaf0); border-radius: 10px;
    background: #fff; color: var(--navy, #0f1e2e); font-size: 13.5px; font-weight: 600;
    cursor: pointer; transition: all .15s; min-height: 40px; }
  .px6-opt:hover { border-color: var(--blue-200, #bfddf7); }
  .px6-opt--active { border-color: var(--blue, #1c8ce3); background: var(--blue-50, #eaf4fd); color: var(--blue-700, #0f62a8); }

  /* Country select */
  .px6-country-wrap { position: relative; display: flex; align-items: center; gap: 8px;
    border: 1.5px solid var(--border, #e6eaf0); border-radius: 10px; padding: 0 12px; min-height: 44px; background: #fff; }
  .px6-flag { border-radius: 3px; object-fit: cover; flex: none; box-shadow: 0 0 0 1px rgba(16,32,46,.08); }
  .px6-select { flex: 1; border: none; outline: none; background: transparent; font-size: 14px;
    color: var(--ink, #10202e); padding: 10px 0; cursor: pointer; min-width: 0; }

  /* Count stepper */
  .px6-stepper { display: inline-flex; align-items: stretch; border: 1.5px solid var(--border, #e6eaf0);
    border-radius: 10px; overflow: hidden; width: max-content; }
  .px6-step-btn { width: 42px; min-height: 44px; border: none; background: var(--blue-50, #eaf4fd);
    color: var(--blue-700, #0f62a8); font-size: 20px; font-weight: 700; cursor: pointer; line-height: 1; }
  .px6-step-btn:hover { background: var(--blue-100, #d6eafb); }
  .px6-count-input { width: 64px; border: none; outline: none; text-align: center; font-size: 15px;
    font-weight: 700; color: var(--navy, #0f1e2e); -moz-appearance: textfield; }
  .px6-count-input::-webkit-outer-spin-button, .px6-count-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

  /* Footer: price + buy */
  .px6-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px;
    margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border, #e6eaf0); flex-wrap: wrap; }
  .px6-price-box { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .px6-price-total { font-size: 26px; font-weight: 800; color: var(--navy, #0f1e2e); line-height: 1; }
  .px6-price-single { font-size: 12.5px; color: var(--muted, #5b6472); }
  .px6-price-loading { font-size: 14px; color: var(--muted, #5b6472); }
  .px6-price-err { font-size: 14px; font-weight: 600; color: var(--red, #d63b3b); }

  /* Buttons */
  .px6-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: none;
    border-radius: 10px; font-weight: 700; font-size: 14.5px; cursor: pointer; padding: 11px 22px;
    min-height: 44px; transition: all .15s; text-decoration: none; }
  .px6-btn:disabled { opacity: .55; cursor: not-allowed; }
  .px6-btn--primary { background: var(--blue, #1c8ce3); color: #fff; }
  .px6-btn--primary:hover:not(:disabled) { background: var(--blue-600, #1577c7); }
  .px6-btn--secondary { background: var(--blue-50, #eaf4fd); color: var(--blue-700, #0f62a8); }
  .px6-btn--secondary:hover { background: var(--blue-100, #d6eafb); }
  .px6-btn--ghost { background: transparent; color: var(--blue-700, #0f62a8); padding: 8px 12px; min-height: 38px; font-size: 13px; }
  .px6-btn--ghost:hover { background: var(--blue-50, #eaf4fd); }
  .px6-buy { flex: none; }

  .px6-error { margin-top: 14px; padding: 11px 14px; background: var(--red-bg, #fbeaea);
    color: var(--red, #d63b3b); border-radius: 10px; font-size: 13.5px; }
  .px6-terms { margin: 12px 0 0; font-size: 12px; color: var(--muted-2, #869099); }
  .px6-terms :global(a) { color: var(--blue, #1c8ce3); }

  /* Success */
  .px6-success-top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .px6-success-ic { flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--green-bg, #e7f6ed);
    color: var(--green, #15a05a); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
  .px6-success-title { font-size: 17px; font-weight: 800; color: var(--navy, #0f1e2e); }
  .px6-success-sub { font-size: 13px; color: var(--muted, #5b6472); }
  .px6-copyall { margin-left: auto; }

  .px6-proxy-list { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; }
  .px6-proxy-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px;
    border: 1px solid var(--border, #e6eaf0); border-radius: 10px; background: var(--blue-50, #f6fbff); flex-wrap: wrap; }
  .px6-proxy-line { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
    color: var(--navy, #0f1e2e); word-break: break-all; flex: 1; min-width: 180px; }
  .px6-proxy-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .px6-chip { font-size: 11px; font-weight: 700; color: var(--blue-700, #0f62a8);
    background: var(--blue-100, #d6eafb); padding: 2px 7px; border-radius: 6px; }
  .px6-proxy-end { font-size: 11.5px; color: var(--muted, #5b6472); white-space: nowrap; }
  .px6-copyone { flex: none; }

  .px6-success-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; align-items: center; }

  /* Responsive */
  @media (max-width: 640px) {
    .px6-card { padding: 16px 14px; }
    .px6-grid { grid-template-columns: 1fr; gap: 14px; }
    .px6-footer { flex-direction: column; align-items: stretch; }
    .px6-buy { width: 100%; }
    .px6-price-box { align-items: flex-start; }
    .px6-copyall { margin-left: 0; }
    .px6-proxy-line { min-width: 140px; }
  }

  /* Mini App */
  html.tg-webapp .px6-card { padding: 14px 12px; }
  html.tg-webapp .px6-proxy-list { max-height: 280px; }
`
