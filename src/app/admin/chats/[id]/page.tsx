'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import OrderChat from '@/components/OrderChat'

export default function AdminChatPage() {
  const params = useParams()
  const orderId = params.id as string

  return (
    <div className="max-w-3xl">
      <Link href={`/admin/orders/${orderId}`} className="btn btn-primary btn-block mb-6">
        Перейти в заказ
      </Link>

      <OrderChat apiBase={`/api/admin/orders/${orderId}/chat`} role="admin" />
    </div>
  )
}
