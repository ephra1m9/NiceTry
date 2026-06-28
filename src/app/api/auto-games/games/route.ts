import { NextResponse } from 'next/server'
import { getGameTopupGames, getGameDenominations } from '@/lib/game-topup-settings'

// Витрина игровых пополнений — публичный эндпоинт, кэш 5 мин.
export const revalidate = 300

/**
 * GET /api/auto-games/games — список активных игр с деноминациями (price_rub из кэша).
 * Деноминации уже содержат кешированную price_rub (пересчитывается при изменении наценки).
 */
export async function GET() {
  try {
    const games = await getGameTopupGames()
    const gamesWithDenominations = await Promise.all(
      games.map(async (game) => {
        const denominations = await getGameDenominations(game.id)
        return { ...game, denominations }
      })
    )
    return NextResponse.json({ games: gamesWithDenominations })
  } catch (error: any) {
    console.error('[api/auto-games/games] error:', error?.message)
    return NextResponse.json({ error: 'Не удалось загрузить список игр' }, { status: 500 })
  }
}
