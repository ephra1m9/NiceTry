'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTelegram } from '@/hooks/useTelegram'
import { computeGiftTotal, isSteamInviteUrl } from '@/lib/dessly-gift'

interface GameEntry {
  app_id: number
  name: string
  image_url: string | null
  image_fallback: boolean
}

interface DesslyConfig {
  enabled?: boolean
  commission_percent: number
  mode: 'embed' | 'native'
  widget_url: string | null
  regions: string[]
}

export default function SendGamePage() {
  const router = useRouter()
  const { isTelegram } = useTelegram()
  const [config, setConfig] = useState<DesslyConfig | null>(null)
  const [allGames, setAllGames] = useState<GameEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(null)
  const [region, setRegion] = useState('RU')
  const [invite, setInvite] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  // Config
  useEffect(() => {
    fetch('/api/dessly/config')
      .then((r) => r.json())
      .then((c: DesslyConfig) => {
        setConfig(c)
        if (c.regions?.length) setRegion(c.regions[0])
      })
      .catch(() => setConfig({ commission_percent: 4, mode: 'native', widget_url: null, regions: ['RU'] }))
  }, [])

  // Games — fetch ALL from live Dessly API (with search support)
  useEffect(() => {
    fetch('/api/dessly/games?limit=200')
      .then((r) => r.json())
      .then((data) => {
        setAllGames(data.games || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Search: client-side filter (debounced)
  const filteredGames = useMemo(() => {
    if (!search.trim()) return allGames
    const q = search.toLowerCase()
    return allGames.filter((g) => g.name.toLowerCase().includes(q))
  }, [allGames, search])

  const inviteValid = isSteamInviteUrl(invite)

  // Статичная цена для сетки — берём из категории (см. ниже). Реальная цена считается
  // после выбора региона через getGame, но для сетки показываем цену из каталога.
  // В боевом режиме цена будет 0 (т.к. games не отдают цену), и расчёт идёт после выбора региона.
  const calc = useMemo(
    () => computeGiftTotal(0, config?.commission_percent ?? 4),
    [config]
  )

  const openWidget = () => {
    if (!config?.widget_url) return
    const tg = (window as any).Telegram?.WebApp
    if (isTelegram && tg?.openLink) tg.openLink(config.widget_url)
    else window.open(config.widget_url, '_blank', 'noopener,noreferrer')
  }

  const submit = async () => {
    setMessage(null)
    if (!selectedGame) {
      setMessage({ kind: 'error', text: 'Выберите игру' })
      return
    }
    if (!inviteValid) {
      setMessage({ kind: 'error', text: 'Укажите корректную ссылку-приглашение Steam (https://s.team/p/...)' })
      return
    }
    try {
      setSubmitting(true)
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: 'balance',
          items: [
            {
              product_id: String(selectedGame.app_id),
              quantity: 1,
              form_data: { recipient: invite.trim(), region },
            },
          ],
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.push('/auth/login?redirect=/send-game')
        return
      }
      if (!res.ok) {
        setMessage({ kind: 'error', text: body.error || 'Не удалось оформить отправку' })
        return
      }
      setMessage({
        kind: 'success',
        text: `Заказ оформлен (${body.order?.status === 'delivered' ? 'отправлено' : 'в обработке'}). Номер: ${body.order?.order_number || ''}`,
      })
    } catch {
      setMessage({ kind: 'error', text: 'Ошибка сети, повторите попытку' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container py-8" style={{ maxWidth: 900 }}>
      {/* Заголовок */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f1e3c', marginBottom: 6 }}>
          Отправь игру в стим
        </h1>
        <p style={{ color: '#5b6b86' }}>
          Подарите игру по ссылке-приглашению Steam. Оплата — с внутреннего баланса.
        </p>
      </div>

      {/* Выключена админом */}
      {config && config.enabled === false ? (
        <div className="card card-pad" style={{ background: '#fff', border: '1px solid #dbe7fb' }}>
          <p style={{ color: '#5b6b86' }}>Отправка игр временно недоступна. Загляните позже.</p>
        </div>
      ) : /* EMBED */
      config?.mode === 'embed' && config.widget_url ? (
        <div className="card card-pad" style={{ background: '#fff', border: '1px solid #dbe7fb' }}>
          <p style={{ color: '#5b6b86', marginBottom: 14 }}>
            Откроется готовое окно Dessly с выбором игры, издания, региона и расчётом.
          </p>
          <button onClick={openWidget} className="btn btn-primary btn-lg">
            Открыть окно отправки
          </button>
          {!isTelegram && (
            <div style={{ marginTop: 16, borderRadius: 12, overflow: 'hidden', border: '1px solid #dbe7fb' }}>
              <iframe
                src={config.widget_url}
                title="Dessly — отправка игры"
                style={{ width: '100%', height: 620, border: 0 }}
              />
            </div>
          )}
        </div>
      ) : (
        /* NATIVE — сетка с картинками */
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Шаг 1: Выбор игры */}
          <div className="card card-pad" style={{ background: '#fff', border: '1px solid #dbe7fb' }}>
            <h3 style={{ fontWeight: 700, color: '#0f1e3c', marginBottom: 12, fontSize: 16 }}>
              1. Выберите игру
            </h3>

            {/* Поиск */}
            <input
              className="input"
              type="text"
              placeholder="Поиск по названию (например: Among Us, Counter-Strike, Cyberpunk)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />

            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#5b6b86' }}>
                Загрузка каталога игр...
              </div>
            ) : filteredGames.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#5b6b86' }}>
                {search ? 'Ничего не найдено. Попробуйте другой запрос.' : 'Сейчас нет доступных игр.'}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: '#8a97ab', marginBottom: 10 }}>
                  Найдено: {filteredGames.length} игр
                  {search && allGames.length !== filteredGames.length && ` (из ${allGames.length})`}
                </div>

                {/* Сетка игр — скроллируемая */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: 10,
                    maxHeight: 480,
                    overflowY: 'auto',
                    padding: '2px',
                  }}
                >
                  {filteredGames.slice(0, 120).map((game) => (
                    <GameCard
                      key={game.app_id}
                      game={game}
                      selected={selectedGame?.app_id === game.app_id}
                      onSelect={() => setSelectedGame(game)}
                    />
                  ))}
                  {filteredGames.length > 120 && (
                    <div style={{
                      gridColumn: '1 / -1',
                      textAlign: 'center',
                      padding: 12,
                      color: '#8a97ab',
                      fontSize: 13,
                    }}>
                      Показаны первые 120 из {filteredGames.length}. Уточните поиск для более узкого результата.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Шаг 2: Регион + Invite */}
          {selectedGame && (
            <div className="card card-pad" style={{ background: '#fff', border: '1px solid #dbe7fb' }}>
              <h3 style={{ fontWeight: 700, color: '#0f1e3c', marginBottom: 12, fontSize: 16 }}>
                2. Данные отправки
              </h3>

              <div style={{ display: 'grid', gap: 12 }}>
                {/* Выбранная игра */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: '#f4f8ff', borderRadius: 10, padding: '8px 12px',
                  border: '1px solid #e2ecfb',
                }}>
                  <GameImage src={selectedGame.image_url} name={selectedGame.name} size={40} />
                  <span style={{ fontWeight: 600, color: '#0f1e3c' }}>{selectedGame.name}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#0f1e3c', fontSize: 14 }}>Регион аккаунта</span>
                    <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                      {(config?.regions || ['RU', 'KZ', 'UA', 'TR', 'CN', 'KR', 'ID', 'VN', 'IN']).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontWeight: 600, color: '#0f1e3c', fontSize: 14 }}>Ссылка-приглашение Steam</span>
                  <input
                    className="input"
                    placeholder="https://s.team/p/xxxx-xxxx"
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                  />
                  {invite && !inviteValid && (
                    <span style={{ color: '#c0392b', fontSize: 12 }}>
                      Формат: https://s.team/p/... (или steamcommunity.com/p/...)
                    </span>
                  )}
                </label>

                <details style={{ background: '#f4f8ff', borderRadius: 10, padding: '8px 12px', border: '1px solid #e2ecfb' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#1f6feb', fontSize: 13 }}>
                    Как получить ссылку-приглашение?
                  </summary>
                  <ol style={{ margin: '8px 0 0', paddingLeft: 16, color: '#5b6b86', lineHeight: 1.5, fontSize: 13 }}>
                    <li>Откройте Steam → «Друзья» → «Добавить друга».</li>
                    <li>Нажмите «Скопировать ссылку» под вашим QR-кодом приглашения.</li>
                    <li>Вставьте ссылку вида https://s.team/p/... в поле выше.</li>
                  </ol>
                </details>
              </div>
            </div>
          )}

          {/* Шаг 3: Оплата */}
          {selectedGame && (
            <div className="card card-pad" style={{ background: '#fff', border: '1px solid #dbe7fb' }}>
              <h3 style={{ fontWeight: 700, color: '#0f1e3c', marginBottom: 12, fontSize: 16 }}>
                3. Подтверждение
              </h3>

              <div style={{ display: 'grid', gap: 8, borderTop: '1px solid #eef2f8', paddingTop: 12 }}>
                <Row label="Игра" value={selectedGame.name} />
                <Row label="Регион" value={region} />
                <Row label={`Комиссия сервиса (${config?.commission_percent ?? 4}%)`} value="см. после выбора издания" />
                <Row
                  label="К оплате"
                  value="Определяется поставщиком"
                  strong
                />
              </div>

              <p style={{ fontSize: 12, color: '#8a97ab', marginTop: 8 }}>
                Точная цена зависит от издания и региона — будет рассчитана при оформлении.
              </p>

              {message && (
                <div
                  style={{
                    padding: '10px 14px', borderRadius: 10, marginTop: 12,
                    background: message.kind === 'error' ? '#fdecea' : '#eafaf1',
                    color: message.kind === 'error' ? '#c0392b' : '#1e8449',
                    fontSize: 14,
                  }}
                >
                  {message.text}
                </div>
              )}

              <button
                onClick={submit}
                disabled={submitting || !inviteValid || !selectedGame}
                className="btn btn-primary btn-lg"
                style={{ marginTop: 14, width: '100%' }}
              >
                {submitting ? 'Оформляем…' : 'Оплатить с баланса'}
              </button>

              <p style={{ fontSize: 12, color: '#8a97ab', marginTop: 8, textAlign: 'center' }}>
                Нажимая «Оплатить с баланса», вы подтверждаете отправку игры на указанный аккаунт.{' '}
                <Link href="/offer" className="link">Условия</Link>.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Подкомпоненты ---

function GameCard({
  game,
  selected,
  onSelect,
}: {
  game: GameEntry
  selected: boolean
  onSelect: () => void
}) {
  const [imgError, setImgError] = useState(false)

  return (
    <div
      onClick={onSelect}
      style={{
        cursor: 'pointer',
        borderRadius: 10,
        border: selected ? '2px solid #1f6feb' : '1px solid #e2ecfb',
        background: selected ? '#f0f6ff' : '#fff',
        overflow: 'hidden',
        transition: 'all 0.15s',
        textAlign: 'center',
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = '#c4d8f7'
          ;(e.currentTarget as HTMLElement).style.background = '#fafcff'
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = '#e2ecfb'
          ;(e.currentTarget as HTMLElement).style.background = '#fff'
        }
      }}
    >
      <GameImage
        src={imgError ? null : game.image_url}
        name={game.name}
        size={undefined}
        onError={() => setImgError(true)}
      />
      <div style={{ padding: '6px 8px 8px', fontSize: 12, fontWeight: 600, color: '#0f1e3c', lineHeight: 1.3 }}>
        {game.name}
      </div>
    </div>
  )
}

function GameImage({
  src,
  name,
  size,
  onError,
}: {
  src: string | null
  name: string
  size?: number
  onError?: () => void
}) {
  const [err, setErr] = useState(false)

  if (!src || err) {
    // Fallback: цветной квадрат с первой буквой
    const letter = (name || '?')[0].toUpperCase()
    const hue = (name || 'a').charCodeAt(0) * 37 % 360
    const s = size || '100%'
    return (
      <div
        style={{
          width: typeof s === 'number' ? s : undefined,
          height: typeof s === 'number' ? s : 100,
          aspectRatio: typeof s === 'number' ? undefined : '460 / 215',
          background: `linear-gradient(135deg, hsl(${hue},50%,40%), hsl(${hue},40%,25%))`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: typeof s === 'number' ? s * 0.5 : 28,
          fontWeight: 800,
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
      onError={() => {
        setErr(true)
        onError?.()
      }}
      style={{
        width: '100%',
        height: 'auto',
        aspectRatio: '460 / 215',
        objectFit: 'cover',
        display: 'block',
        background: '#eef2f8',
      }}
    />
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: strong ? '#0f1e3c' : '#5b6b86', fontWeight: strong ? 700 : 400, fontSize: 14 }}>
        {label}
      </span>
      <span style={{ color: '#0f1e3c', fontWeight: strong ? 800 : 600, fontSize: strong ? 18 : 14 }}>
        {value}
      </span>
    </div>
  )
}
