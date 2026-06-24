'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ChatRow {
  id: string
  order_id: string
  status: 'open' | 'closed'
  order_number: string
  order_status: string
  last_message_at: string
  last_sender_type: 'user' | 'admin' | 'system' | null
  user_email: string | null
  user_telegram_username: string | null
  needs_attention: boolean
}

export default function AdminChatsPage() {
  const [chats, setChats] = useState<ChatRow[]>([])
  const [loading, setLoading] = useState(true)
  const [closingChat, setClosingChat] = useState<ChatRow | null>(null)

  const load = () => {
    fetch('/api/admin/chats')
      .then((r) => r.json())
      .then((data) => setChats(data.chats || []))
      .catch((e) => console.error('Failed to fetch chats:', e))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Чаты</h1>
        <p className="text-muted">
          Переписка по заказам. «Нужна выдача» — заказы с товарами без авто-выдачи, ожидающие ответа менеджера.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted">Загрузка...</div>
      ) : chats.length === 0 ? (
        <div className="card card-pad text-center py-12 text-muted">Чатов пока нет</div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-bg border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Заказ</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Покупатель</th>
                  <th className="text-center p-4 text-sm font-semibold text-navy">Внимание</th>
                  <th className="text-left p-4 text-sm font-semibold text-navy">Последнее сообщение</th>
                  <th className="text-right p-4 text-sm font-semibold text-navy">Действия</th>
                </tr>
              </thead>
              <tbody>
                {chats.map((chat) => (
                  <tr key={chat.id} className="border-b border-border hover:bg-gray-bg">
                    <td className="p-4">
                      <div className="font-semibold text-navy">#{chat.order_number}</div>
                    </td>
                    <td className="p-4 text-muted">
                      {chat.user_email || (chat.user_telegram_username ? `@${chat.user_telegram_username}` : 'Гость')}
                    </td>
                    <td className="p-4 text-center">
                      {chat.needs_attention && <span className="badge badge-amber">Нужна выдача</span>}
                    </td>
                    <td className="p-4 text-muted">
                      {senderLabel(chat.last_sender_type)} · {new Date(chat.last_message_at).toLocaleString('ru-RU')}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end items-center gap-2">
                        <Link href={`/admin/chats/${chat.order_id}`} className="btn btn-sm btn-ghost">
                          Перейти в чат
                        </Link>
                        {chat.status === 'open' ? (
                          <button className="btn btn-sm btn-ghost text-red" onClick={() => setClosingChat(chat)}>
                            Закрыть чат
                          </button>
                        ) : (
                          <span className="badge">Закрыт</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {closingChat && (
        <CloseChatModal
          chat={closingChat}
          onClose={() => setClosingChat(null)}
          onClosed={() => {
            setClosingChat(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function CloseChatModal({
  chat,
  onClose,
  onClosed,
}: {
  chat: ChatRow
  onClose: () => void
  onClosed: () => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('Укажите причину закрытия')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/orders/${chat.order_id}/chat`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не удалось закрыть чат')
      onClosed()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось закрыть чат')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card card-pad max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1">Закрыть чат заказа #{chat.order_number}</h2>
        <p className="text-sm text-muted mb-4">
          Покупатель сохранит доступ к истории переписки, но не сможет писать новые сообщения. Причина будет
          показана ему в чате.
        </p>
        <textarea
          className="input min-h-[90px] mb-3"
          placeholder="Причина закрытия чата…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        {error && <div className="alert alert-error mb-3">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || !reason.trim()}>
            {submitting ? 'Закрытие…' : 'Закрыть чат'}
          </button>
        </div>
      </div>
    </div>
  )
}

function senderLabel(type: ChatRow['last_sender_type']): string {
  switch (type) {
    case 'user':
      return 'Покупатель'
    case 'admin':
      return 'Менеджер'
    case 'system':
      return 'Система'
    default:
      return '—'
  }
}
