import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { listChatsForAdmin } from '@/lib/chat'

/** GET /api/admin/chats — список чатов по заказам, для раздела «Чаты» в админке. */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20))

  const { chats, total } = await listChatsForAdmin({ page, limit })
  return NextResponse.json({ chats, total, page, hasMore: page * limit < total })
}
