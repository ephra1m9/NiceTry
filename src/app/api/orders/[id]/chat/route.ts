import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getChatByOrder, listMessages, postMessage } from '@/lib/chat'

const MAX_MESSAGE_LENGTH = 4000

async function requireOwnOrder(orderId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: order } = await supabaseAdmin.from('orders').select('id, user_id').eq('id', orderId).maybeSingle()
  if (!order || order.user_id !== user.id) {
    return { ok: false as const, response: NextResponse.json({ error: 'Заказ не найден' }, { status: 404 }) }
  }
  return { ok: true as const, userId: user.id }
}

/** GET /api/orders/[id]/chat — чат заказа создаётся хуками выдачи при оплате, тут только чтение. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireOwnOrder(params.id)
  if (!guard.ok) return guard.response

  const chat = await getChatByOrder(params.id)
  if (!chat) return NextResponse.json({ error: 'Чат пока не создан' }, { status: 404 })

  const messages = await listMessages(chat.id)
  return NextResponse.json({ chat, messages })
}

/** POST /api/orders/[id]/chat — покупатель пишет в свой чат. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireOwnOrder(params.id)
  if (!guard.ok) return guard.response

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Сообщение не может быть пустым' }, { status: 400 })
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'Сообщение слишком длинное' }, { status: 400 })
  }

  const chat = await getChatByOrder(params.id)
  if (!chat) return NextResponse.json({ error: 'Чат пока не создан' }, { status: 404 })
  if (chat.status !== 'open') return NextResponse.json({ error: 'Чат закрыт' }, { status: 409 })

  const message = await postMessage(chat.id, 'user', guard.userId, text)
  return NextResponse.json({ message })
}
