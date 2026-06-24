import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { getChatByOrder, listMessages, postMessage, closeChat } from '@/lib/chat'

const MAX_MESSAGE_LENGTH = 4000

/** GET /api/admin/orders/[id]/chat */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const chat = await getChatByOrder(params.id)
  if (!chat) return NextResponse.json({ error: 'Чат пока не создан' }, { status: 404 })

  const messages = await listMessages(chat.id)
  return NextResponse.json({ chat, messages })
}

/** POST /api/admin/orders/[id]/chat — ответ/выдача товара админом прямо в чате. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
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

  const message = await postMessage(chat.id, 'admin', guard.userId, text)
  return NextResponse.json({ message })
}

/** PATCH /api/admin/orders/[id]/chat — продавец закрывает чат с указанием причины. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const body = await request.json().catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return NextResponse.json({ error: 'Укажите причину закрытия' }, { status: 400 })

  const chat = await getChatByOrder(params.id)
  if (!chat) return NextResponse.json({ error: 'Чат пока не создан' }, { status: 404 })
  if (chat.status === 'closed') return NextResponse.json({ error: 'Чат уже закрыт' }, { status: 409 })

  await closeChat(chat.id, reason)
  return NextResponse.json({ ok: true })
}
