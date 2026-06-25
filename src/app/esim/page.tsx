import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import EsimClient from './EsimClient'

export const metadata: Metadata = {
  title: 'Купить eSIM онлайн — интернет и звонки за границей | NiceTry',
  description:
    'eSIM-карты с мгновенной активацией: только интернет или интернет со звонками и смс. Выберите страну и тариф, оплатите с баланса или картой.',
}

// Серверная оболочка: тянет email активной сессии (для предзаполнения чека при оплате картой),
// форму/визард рендерит клиентский компонент. Конфиг (вкл/выкл раздела) клиент тянет сам — /api/dessly/config.
export const dynamic = 'force-dynamic'

export default async function EsimPage() {
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

  return <EsimClient sessionEmail={sessionEmail} />
}
