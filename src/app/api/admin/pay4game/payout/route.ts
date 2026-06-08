import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdmin } from '@/lib/auth/admin'
import { payoutBanks, payoutCreateSbp, payoutCreateCard, Pay4gameError } from '@/lib/payments/pay4game'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Выплаты pay4game (payout/create) — за ФИЧЕФЛАГОМ PAY4GAME_PAYOUTS_ENABLED=1 и под админом.
 * Используются для возвратов/реферальных выводов. Результат — вебхук status_payoff
 * (обновляет payments.payout_status).
 *
 *   GET                       → список банков СБП (payout/fps/banks)
 *   POST { method:'sbp',  amount, phone, bank_id }            → выплата по СБП
 *   POST { method:'card', amount, card_number, full_name }    → выплата на карту
 *
 * invoice_id выплаты генерируем сами (UUID) и логируем в payments (отдельная строка платежа).
 */
function payoutsEnabled(): boolean {
  return process.env.PAY4GAME_PAYOUTS_ENABLED === '1'
}

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response
  if (!payoutsEnabled()) return NextResponse.json({ error: 'Выплаты отключены' }, { status: 403 })
  try {
    return NextResponse.json({ banks: await payoutBanks() })
  } catch (e) {
    const msg = e instanceof Pay4gameError ? e.message : 'Ошибка pay4game'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response
  if (!payoutsEnabled()) return NextResponse.json({ error: 'Выплаты отключены' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const method = String(body?.method ?? '').trim()
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Некорректная сумма' }, { status: 400 })
  }
  const invoiceId = randomUUID()

  try {
    let res
    if (method === 'sbp') {
      const phone = String(body?.phone ?? '').trim()
      const bankId = String(body?.bank_id ?? '').trim()
      if (!phone || !bankId) return NextResponse.json({ error: 'Укажите phone и bank_id' }, { status: 400 })
      res = await payoutCreateSbp({ invoiceId, amount, phone, bankId })
    } else if (method === 'card') {
      const cardNumber = String(body?.card_number ?? '').trim()
      const fullName = String(body?.full_name ?? '').trim()
      if (!cardNumber || !fullName) return NextResponse.json({ error: 'Укажите card_number и full_name' }, { status: 400 })
      res = await payoutCreateCard({ invoiceId, amount, cardNumber, fullName })
    } else {
      return NextResponse.json({ error: 'method должен быть sbp или card' }, { status: 400 })
    }

    // Логируем выплату как строку payments (статус доедет вебхуком status_payoff).
    await supabaseAdmin
      .from('payments')
      .insert({ invoice_id: invoiceId, method, amount, status: 'pending', payout_status: 'pending' })
      .then(({ error }) => {
        if (error) console.error('[admin/payout] payments insert failed:', error)
      })

    return NextResponse.json({ ...res, invoice_id: invoiceId })
  } catch (e) {
    const msg = e instanceof Pay4gameError ? e.message : 'Ошибка pay4game'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
