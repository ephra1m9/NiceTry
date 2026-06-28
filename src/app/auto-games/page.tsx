import { getGameTopupGames, getGameDenominations } from '@/lib/game-topup-settings'
import AutoGamesClient from './AutoGamesClient'

export const revalidate = 300

export const metadata = {
  title: 'Автоматический донат в игры — NiceTry',
  description: 'Мгновенное пополнение Genshin Impact, PUBG Mobile, Free Fire, Mobile Legends и других игр через AppRoute.',
}

export default async function AutoGamesPage() {
  const games = await getGameTopupGames()
  const gamesWithDenominations = await Promise.all(
    games.map(async (game) => {
      const denominations = await getGameDenominations(game.id)
      return { ...game, denominations }
    })
  )
  return <AutoGamesClient games={gamesWithDenominations} />
}
