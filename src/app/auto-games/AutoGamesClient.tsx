'use client'

import Link from 'next/link'
import { GameTopupGame, GameTopupDenomination } from '@/lib/game-topup-settings'

interface GameWithDenominations extends GameTopupGame {
  denominations: GameTopupDenomination[]
}

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

function minPrice(denominations: GameTopupDenomination[]): number | null {
  if (denominations.length === 0) return null
  return Math.min(...denominations.filter((d) => d.is_active).map((d) => d.price_rub))
}

function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value)
}

function GameCard({ game }: { game: GameWithDenominations }) {
  const gradient = GAME_GRADIENTS[game.slug] ?? 'linear-gradient(135deg,#1a1a2e 0%,#4a4a8a 100%)'
  const cover = game.image_url
    ? `url("${game.image_url}") center / cover no-repeat, ${gradient}`
    : gradient
  const activeDenoms = game.denominations.filter((d) => d.is_active)
  const from = minPrice(game.denominations)

  return (
    <Link href={`/auto-games/${game.slug}`} className="pcard" style={{ textDecoration: 'none' }}>
      <div className="cover" style={{ background: cover }}>
        <div className="topbadges">
          <span className="badge badge-instant">Автопополнение</span>
          <span />
        </div>
      </div>

      <div className="body">
        <div className="nm">{game.name}</div>

        <div className="meta">
          {activeDenoms.length > 0
            ? <span>{activeDenoms.length} {activeDenoms.length === 1 ? 'пакет' : activeDenoms.length < 5 ? 'пакета' : 'пакетов'}</span>
            : <span style={{ color: 'var(--muted)' }}>Пакеты не загружены</span>
          }
        </div>

        <div className="foot">
          <div className="price">
            {from !== null ? (
              <span className="now">
                <span style={{ fontSize: 12, color: 'var(--muted-2)', fontWeight: 400 }}>от </span>
                {money(from)}
              </span>
            ) : (
              <span className="now" style={{ fontSize: 14, color: 'var(--muted)' }}>Скоро</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function AutoGamesClient({ games }: { games: GameWithDenominations[] }) {
  return (
    <div className="container py-8">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>Донат в игры</h1>
        <p style={{ color: 'var(--muted)', marginTop: 6, fontSize: 14 }}>
          Мгновенное зачисление напрямую на аккаунт — выберите игру и пакет.
        </p>
      </div>

      {games.length === 0 ? (
        <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center', padding: 40 }}>
          <i className="bi bi-controller" style={{ fontSize: 40, display: 'block', marginBottom: 12 }} aria-hidden="true" />
          <h3 style={{ fontWeight: 700, marginBottom: 8 }}>Пополнения временно недоступны</h3>
          <p style={{ color: 'var(--muted)' }}>Раздел скоро откроется. Попробуйте позже.</p>
        </div>
      ) : (
        <div className="prod-grid">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  )
}
