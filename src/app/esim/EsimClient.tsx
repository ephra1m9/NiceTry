'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/hooks/useUser'

// Витрина eSIM (Dessly): две вкладки сверху переключают тип пакета (DATA-ONLY / DATA-VOICE-SMS).
// У Dessly оба типа в основном привязаны к стране (geo_scope=country на ~193 из ~200 пакетов
// на странице каталога; geo_scope=continent/global — единичные исключения, см. WORKLOG/дамп
// scripts/_dump_dessly_esim.mjs) — поэтому визард на ОБЕИХ вкладках одинаковый:
// СТРАНА → ТАРИФ (на «Только интернет» тариф — чипы ГБ, на «Интернет, звонки, смс» — карточки
// с готовым набором ГБ+минуты+смс), затем подтверждение со способом оплаты (баланс/карта).
// Стран много (~190+), поэтому есть поиск по списку.
// Покупка не лежит в общем каталоге (variant/product приходят от Dessly на лету, цена
// динамическая) — оформление идёт через POST /api/dessly/esim/order, а не /api/orders/create.

type Tab = 'data' | 'data_voice_sms'
type Step = 'country' | 'plan' | 'confirm'
type PageState = 'loading' | 'ready' | 'error'

interface VariantEntry {
  id: string
  name: string
  description: string
  image: string | null
  country: string | null
  continent: string | null
  esim_countries: string[] | null
  package_type: Tab
}

interface PlanEntry {
  id: string
  name: string
  description: string
  price_usd: number
  price_rub: number
  stock: number
  max_per_order: number
  data_gb: number | null
  unlimited: boolean
  validity_days: number | null
  voice_minutes: number | null
  sms_count: number | null
}

interface EsimConfig {
  esim_enabled?: boolean
}

// Полные русские названия стран по ISO-коду — нативно, без ручного словаря на ~190 записей.
let regionNames: Intl.DisplayNames | null = null
try {
  regionNames = new Intl.DisplayNames(['ru'], { type: 'region' })
} catch {
  regionNames = null
}

const CONTINENT_NAMES: Record<string, string> = {
  'Africa': 'Африка',
  'Asia': 'Азия',
  'Caribbean': 'Карибы',
  'Middle East': 'Средний Восток',
  'North America': 'Северная Америка',
  'Oceania': 'Океания',
  'South America': 'Южная Америка',
}

function countryLabel(v: VariantEntry): string {
  if (v.country) {
    try {
      return regionNames?.of(v.country) || v.country
    } catch {
      return v.country
    }
  }
  if (v.continent) return CONTINENT_NAMES[v.continent] ?? v.continent
  if (!v.country && !v.continent && /global/i.test(v.name)) return 'Все страны + РФ'
  return v.name
}

// Скошенный верхний правый угол (как надрезанная SIM-карта) — общий путь для слоя-обводки
// и внутреннего слоя с фоном (одна и та же строка масштабируется под свой box независимо).
const SIM_CARD_CLIP = 'polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%)'

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1]
  return forms[2]
}

function pluralDays(n: number): string {
  return `${n} ${pluralRu(n, ['день', 'дня', 'дней'])}`
}

function pluralMinutes(n: number): string {
  return `${n} ${pluralRu(n, ['минута', 'минуты', 'минут'])}`
}

// Названия/описания тарифов у Dessly приходят на английском ("20GB, 31 Day" / "20GB of data,
// valid 31 Day(s), 30 voice minutes, 50 SMS") — строим русский лейбл из уже распарсенных полей
// (data_gb/validity_days/voice_minutes/sms_count), а не переводим исходный текст.
function dataAmountLabel(p: PlanEntry): string | null {
  if (p.unlimited) return 'Безлимит'
  if (p.data_gb != null) return `${p.data_gb} ГБ`
  return null
}

function planTitle(p: PlanEntry): string {
  const amount = dataAmountLabel(p)
  if (amount == null) return p.name
  const parts = [amount]
  if (p.validity_days != null) parts.push(pluralDays(p.validity_days))
  return parts.join(', ')
}

function planDetails(p: PlanEntry): string {
  const amount = dataAmountLabel(p)
  const parts: string[] = []
  if (amount != null) parts.push(`${amount} интернета`)
  if (p.validity_days != null) parts.push(`действует ${pluralDays(p.validity_days)}`)
  if (p.voice_minutes != null) parts.push(`${pluralMinutes(p.voice_minutes)} разговора`)
  if (p.sms_count != null) parts.push(`${p.sms_count} SMS`)
  return parts.join(', ') || p.description
}

export default function EsimClient({ sessionEmail }: { sessionEmail: string | null }) {
  const router = useRouter()
  const { user: authUser } = useAuth()
  const { user: profile } = useUser()

  const [config, setConfig] = useState<EsimConfig | null>(null)
  const [tab, setTab] = useState<Tab>('data')
  const [step, setStep] = useState<Step>('country')
  const [pageState, setPageState] = useState<PageState>('loading')
  const [errorText, setErrorText] = useState('')

  const [variants, setVariants] = useState<VariantEntry[]>([])
  const [countrySearch, setCountrySearch] = useState('')
  const [selectedVariant, setSelectedVariant] = useState<VariantEntry | null>(null)
  const [plans, setPlans] = useState<PlanEntry[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanEntry | null>(null)

  const [paymentMethod, setPaymentMethod] = useState<'balance' | 'card'>(authUser ? 'balance' : 'card')
  const [guestEmail, setGuestEmail] = useState(sessionEmail ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<{ status: string; activation?: string; order_number?: string } | null>(null)

  // ---- Config ----
  useEffect(() => {
    fetch('/api/dessly/config')
      .then((r) => r.json())
      .then((c: EsimConfig) => setConfig(c))
      .catch(() => setConfig({ esim_enabled: true }))
  }, [])

  // ---- Пакеты (страны) по вкладке ----
  useEffect(() => {
    setPageState('loading')
    setSelectedVariant(null)
    setSelectedPlan(null)
    setPlans([])
    setCountrySearch('')
    setStep('country')

    fetch(`/api/dessly/esim/variants?type=${tab}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setErrorText(data.error)
          setPageState('error')
          return
        }
        setVariants(data.variants || [])
        setPageState('ready')
      })
      .catch(() => {
        setErrorText('Не удалось загрузить список пакетов')
        setPageState('error')
      })
  }, [tab])

  // ---- Тарифы выбранного пакета ----
  useEffect(() => {
    if (!selectedVariant) {
      setPlans([])
      return
    }
    setPlansLoading(true)
    setSelectedPlan(null)
    fetch(`/api/dessly/esim/variants/${encodeURIComponent(selectedVariant.id)}`)
      .then((r) => r.json())
      .then((data) => {
        const list: PlanEntry[] = (data.plans || []).slice()
        list.sort(
          (a, b) =>
            (a.data_gb ?? 0) - (b.data_gb ?? 0) ||
            (a.validity_days ?? 0) - (b.validity_days ?? 0) ||
            a.price_rub - b.price_rub
        )
        setPlans(list)
      })
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false))
  }, [selectedVariant])

  const filteredVariants = useMemo(() => {
    const q = countrySearch.trim().toLowerCase()
    if (q.length < 1) return variants
    return variants.filter((v) => countryLabel(v).toLowerCase().includes(q))
  }, [variants, countrySearch])

  // Группы тарифов «Только интернет» по сроку действия (1 день, 3 дня, 7 дней, 30 дней и т.д.)
  const dataPlanGroups = useMemo(() => {
    const map = new Map<number, PlanEntry[]>()
    for (const p of plans) {
      const key = p.validity_days ?? 0
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [plans])

  const balance = Number(profile?.balance ?? 0)
  const canPayBalance = !!authUser && selectedPlan != null && balance >= (selectedPlan?.price_rub ?? Infinity)
  const emailValid = !!sessionEmail || /\S+@\S+\.\S+/.test(guestEmail.trim())
  const canSubmit =
    selectedVariant &&
    selectedPlan &&
    !submitting &&
    (paymentMethod === 'balance' ? canPayBalance : emailValid)

  const submit = async () => {
    if (!canSubmit || !selectedVariant || !selectedPlan) return
    setSubmitting(true)
    setErrorText('')
    try {
      const res = await fetch('/api/dessly/esim/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variant_id: selectedVariant.id,
          product_id: selectedPlan.id,
          payment_method: paymentMethod,
          ...(sessionEmail ? {} : { email: guestEmail.trim() }),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.push('/auth/login?redirect=/esim')
        return
      }
      if (!res.ok || !body.success) {
        setErrorText(body.error || 'Не удалось оформить покупку')
        return
      }
      if (body.pay_url) {
        router.push(body.pay_url)
        return
      }
      setSuccess({
        status: body.delivery_status || body.order?.status,
        activation: body.activation,
        order_number: body.order?.order_number,
      })
    } catch {
      setErrorText('Ошибка сети, повторите попытку')
    } finally {
      setSubmitting(false)
    }
  }

  const resetAll = () => {
    setSuccess(null)
    setSelectedVariant(null)
    setSelectedPlan(null)
    setStep('country')
    setErrorText('')
  }

  if (config?.esim_enabled === false) {
    return (
      <div className="container py-8" style={{ maxWidth: 720 }}>
        <div className="card card-pad" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <p className="text-muted">Покупка eSIM временно недоступна. Загляните позже.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-8" style={{ maxWidth: 720 }}>
      <div className="mb-5">
        <h1 className="text-[26px] font-bold">Купить eSIM</h1>
        <p className="text-muted text-sm mt-1.5">
          Виртуальная SIM-карта с мгновенной активацией. Выберите страну и тариф — оплатите с баланса или картой.
        </p>
      </div>

      {/* Вкладки */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setTab('data_voice_sms')}
          className={`btn ${tab === 'data_voice_sms' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Интернет, звонки, смс
        </button>
        <button
          type="button"
          onClick={() => setTab('data')}
          className={`btn ${tab === 'data' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Только интернет
        </button>
      </div>

      {success ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', background: 'var(--green-bg, #e7f6ed)',
              color: 'var(--green, #15a05a)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, fontWeight: 800, margin: '0 auto 16px',
            }}
          >
            {success.status === 'delivered'
            ? <i className="bi bi-check-lg" aria-hidden="true" />
            : <i className="bi bi-hourglass-split" aria-hidden="true" />
          }
          </div>
          <h2 className="text-[20px] font-bold mb-2">
            {success.status === 'delivered' ? 'eSIM активирована' : 'Заказ оформлен'}
          </h2>
          {success.order_number && (
            <p className="text-muted text-sm mb-3">Номер заказа: {success.order_number}</p>
          )}
          {success.status === 'delivered' && success.activation ? (
            <pre
              style={{
                textAlign: 'left', whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,.03)',
                borderRadius: 10, padding: 14, fontSize: 13, margin: '0 0 16px',
              }}
            >
              {success.activation}
            </pre>
          ) : (
            <p className="text-muted text-sm mb-4">
              Поставщик ещё обрабатывает выдачу — данные активации придут в чат заказа.
            </p>
          )}
          <button onClick={resetAll} className="btn btn-secondary">
            Купить ещё одну eSIM
          </button>
        </div>
      ) : (
        <>
          {errorText && (
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '12px 16px', background: 'var(--red-bg, #fbeaea)', color: 'var(--red, #d63b3b)',
                borderRadius: 10, marginBottom: 16, fontSize: 14,
              }}
            >
              <span>{errorText}</span>
              <button onClick={() => setErrorText('')} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
          )}

          {/* STEP 1: страна */}
          {step === 'country' && (
            <div className="card card-pad">
              <p className="label mb-2">Страна</p>
              {pageState === 'loading' ? (
                <p className="text-muted text-sm">Загрузка списка стран…</p>
              ) : variants.length === 0 ? (
                <p className="text-muted text-sm">Для этой вкладки пока нет доступных пакетов.</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    placeholder="Поиск по стране…"
                    className="w-full px-3 py-2 rounded-lg border border-border mb-3"
                  />
                  {filteredVariants.length === 0 ? (
                    <p className="text-muted text-sm">Ничего не найдено.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2" style={{ maxHeight: 420, overflowY: 'auto' }}>
                      {filteredVariants.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => { setSelectedVariant(v); setStep('plan') }}
                          className={`btn ${selectedVariant?.id === v.id ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                        >
                          <CountryFlag code={v.country} />
                          {countryLabel(v)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 2: тариф выбранной страны */}
          {step === 'plan' && selectedVariant && (
            <div className="card card-pad">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CountryFlag code={selectedVariant.country} />
                  <span className="font-semibold">{countryLabel(selectedVariant)}</span>
                </div>
                <button onClick={() => setStep('country')} className="text-sm" style={{ color: 'var(--blue, #1c8ce3)', background: 'none', border: 0, cursor: 'pointer' }}>
                  Изменить
                </button>
              </div>

              <p className="label mb-2">{tab === 'data' ? 'Объём интернета' : 'Тариф'}</p>
              {plansLoading ? (
                <p className="text-muted text-sm">Загрузка тарифов…</p>
              ) : plans.length === 0 ? (
                <p className="text-muted text-sm">Нет доступных тарифов для этого пакета.</p>
              ) : tab === 'data' ? (
                <div className="space-y-3">
                  {dataPlanGroups.map(([days, group]) => (
                    <div
                      key={days}
                      style={{ border: '1px solid var(--border, #e6eaf0)', borderRadius: 12, padding: 14 }}
                    >
                      <p className="text-muted-2 text-[12px] mb-2">
                        {days > 0 ? pluralDays(days) : 'Срок не указан'}
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 12 }}>
                        {group.map((p) => {
                          const active = selectedPlan?.id === p.id
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => { setSelectedPlan(p); setStep('confirm') }}
                              disabled={p.stock <= 0}
                              className="esim-sim-card"
                              style={{
                                background: active ? 'var(--blue, #1c8ce3)' : 'var(--border, #e6eaf0)',
                                clipPath: SIM_CARD_CLIP,
                                cursor: p.stock > 0 ? 'pointer' : 'not-allowed',
                                opacity: p.stock > 0 ? 1 : 0.5,
                              }}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: '1.5px',
                                  borderRadius: 8,
                                  background: active ? 'var(--blue-50, #eaf4fd)' : 'linear-gradient(100deg, #e3efff 0%, #f4f9ff 55%, #ffffff 100%)',
                                  clipPath: SIM_CARD_CLIP,
                                }}
                              >
                                <span style={{ position: 'absolute', top: 12, left: 14, fontSize: 15, fontWeight: 600, color: 'var(--navy, #16243f)', lineHeight: 1.1 }}>
                                  {dataAmountLabel(p) ?? p.name}
                                </span>
                                <span style={{ position: 'absolute', bottom: 10, right: 14, fontSize: 17, fontWeight: 800, color: active ? 'var(--blue, #1c8ce3)' : 'var(--navy, #16243f)' }}>
                                  {p.price_rub} ₽
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {plans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedPlan(p); setStep('confirm') }}
                      disabled={p.stock <= 0}
                      className="w-full text-left"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        padding: '12px 14px', borderRadius: 10, border: '1.5px solid var(--border, #e6eaf0)',
                        background: selectedPlan?.id === p.id ? 'var(--blue-50, #eaf4fd)' : '#fff',
                        borderColor: selectedPlan?.id === p.id ? 'var(--blue, #1c8ce3)' : undefined,
                        cursor: p.stock > 0 ? 'pointer' : 'not-allowed',
                        opacity: p.stock > 0 ? 1 : 0.5,
                      }}
                    >
                      <span>
                        <span className="font-semibold block">{planTitle(p)}</span>
                        {planDetails(p) && <span className="text-muted-2 text-[12px]">{planDetails(p)}</span>}
                      </span>
                      <span className="font-bold whitespace-nowrap">{p.price_rub} ₽</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: подтверждение */}
          {step === 'confirm' && selectedVariant && selectedPlan && (
            <div className="card card-pad">
              <h3 className="font-semibold text-[16px] mb-3">Подтверждение покупки</h3>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-muted">{selectedVariant.country ? 'Страна' : 'Покрытие'}</span>
                  <span className="font-semibold text-right">{countryLabel(selectedVariant)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Тариф</span>
                  <span className="font-semibold text-right">{planTitle(selectedPlan)}</span>
                </div>
                <div className="flex justify-between font-semibold text-base pt-2 border-t border-border">
                  <span>К оплате</span>
                  <span>{selectedPlan.price_rub} ₽</span>
                </div>
              </div>

              <p className="label mb-2">Способ оплаты</p>
              <div className="flex gap-2 mb-3">
                {authUser && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('balance')}
                    className={`btn ${paymentMethod === 'balance' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                  >
                    С баланса · {balance} ₽
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`btn ${paymentMethod === 'card' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                >
                  Картой
                </button>
              </div>
              {paymentMethod === 'balance' && !canPayBalance && (
                <p className="text-[13px] mb-3" style={{ color: 'var(--red, #d63b3b)' }}>
                  Недостаточно средств на балансе для оплаты этим способом.
                </p>
              )}

              {paymentMethod === 'card' && !sessionEmail && (
                <div className="mb-3">
                  <label htmlFor="esim-email" className="label">Email для чека</label>
                  <input
                    id="esim-email"
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full px-3 py-2 rounded-lg border border-border"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="btn btn-primary btn-lg btn-block"
              >
                {submitting ? 'Оформляем…' : `Оплатить · ${selectedPlan.price_rub} ₽`}
              </button>
              <button
                type="button"
                onClick={() => setStep('plan')}
                style={{ background: 'none', border: 0, cursor: 'pointer', display: 'block', margin: '10px auto 0' }}
                className="text-sm text-muted"
              >
                Назад к выбору тарифа
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Флаг страны (flagcdn) с текстовым фолбэком — эмодзи-флаги не рендерятся на Windows. */
function CountryFlag({ code }: { code: string | null }) {
  const [err, setErr] = useState(false)
  if (!code || err) {
    return <span aria-hidden style={{ marginRight: 6 }}>🌍</span>
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code.toLowerCase()}.png`}
      width={20}
      height={15}
      alt={code}
      onError={() => setErr(true)}
      style={{ marginRight: 6, borderRadius: 2, objectFit: 'cover', verticalAlign: '-3px' }}
    />
  )
}
