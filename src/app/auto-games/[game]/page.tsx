import { notFound } from 'next/navigation'
import { getGameTopupGame, getGameDenominations } from '@/lib/game-topup-settings'
import GameTopupClient from './GameTopupClient'

export const revalidate = 300

interface Props {
  params: Promise<{ game: string }>
}

export async function generateMetadata({ params }: Props) {
  const { game: slug } = await params
  const game = await getGameTopupGame(slug)
  if (!game) return { title: 'Игра не найдена — NiceTry' }
  return {
    title: `${game.name} — донат — NiceTry`,
    description: `Мгновенное пополнение ${game.name} через AppRoute. Выберите пакет и введите ID аккаунта.`,
  }
}

export default async function GameTopupPage({ params }: Props) {
  const { game: slug } = await params
  const game = await getGameTopupGame(slug)
  if (!game) notFound()

  const denominations = await getGameDenominations(game.id)
  return <GameTopupClient game={game} denominations={denominations} />
}
