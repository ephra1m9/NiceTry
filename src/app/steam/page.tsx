import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getSteamTopupConfig } from '@/lib/steam-topup'
import SteamTopupClient from './SteamTopupClient'

export const metadata: Metadata = {
  title: 'Пополнить Steam-кошелёк — мгновенно, комиссия 3% | NiceTry',
  description:
    'Пополнение Steam-кошелька по честному курсу. Выберите регион и сумму, оплатите удобным способом — зачисление мгновенно.',
}

// Серверная оболочка: тянет лимиты/комиссию из env и email активной сессии (для предзаполнения),
// форму рендерит клиентский компонент.
export const dynamic = 'force-dynamic'

export default async function SteamTopupPage() {
  const config = getSteamTopupConfig()

  let sessionEmail: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    sessionEmail = user?.email ?? null
  } catch {
    sessionEmail = null
  }

  return <SteamTopupClient config={config} sessionEmail={sessionEmail} />
}
