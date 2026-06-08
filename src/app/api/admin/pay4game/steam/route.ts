import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import {
  steamTopupBalance,
  steamTopupCheck,
  steamTopupGetStatus,
  Pay4gameError,
} from '@/lib/payments/pay4game'

export const dynamic = 'force-dynamic'

/**
 * Админ-инструменты пополнения Steam (pay4game v2). Только чтение/проверки:
 *   GET  ?action=balance                         → баланс агента
 *   GET  ?action=status&agent_transaction_id=…   → статус транзакции
 *   POST { account, amount }                     → check (проверка возможности, БЕЗ списания)
 *
 * Основной поток «оплата товара Steam-пополнения» идёт через payment/create со steam_account+
 * steam_amount (вебхук status_steam), здесь — только агентские проверки/баланс. check_pay
 * (реальная транзакция) намеренно НЕ выставлен в API, чтобы случайно не списать деньги.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const action = request.nextUrl.searchParams.get('action') || 'balance'
  try {
    if (action === 'balance') {
      return NextResponse.json(await steamTopupBalance())
    }
    if (action === 'status') {
      const atid = request.nextUrl.searchParams.get('agent_transaction_id')?.trim()
      const inv = request.nextUrl.searchParams.get('invoice_id')?.trim() || undefined
      if (!atid) return NextResponse.json({ error: 'agent_transaction_id обязателен' }, { status: 400 })
      return NextResponse.json(await steamTopupGetStatus(atid, inv))
    }
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Pay4gameError ? e.message : 'Ошибка pay4game'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const body = await request.json().catch(() => null)
  const account = String(body?.account ?? '').trim()
  const amount = Number(body?.amount)
  if (!account || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Укажите account и amount' }, { status: 400 })
  }
  try {
    const res = await steamTopupCheck(account, amount, body?.invoice_id ? String(body.invoice_id) : undefined)
    return NextResponse.json(res)
  } catch (e) {
    const msg = e instanceof Pay4gameError ? e.message : 'Ошибка pay4game'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
