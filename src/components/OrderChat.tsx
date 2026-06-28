'use client'

import { useEffect, useRef, useState } from 'react'
import Card from '@/components/ui/Card'
import { BI } from '@/components/ui/BI'

/**
 * Чат заказа: общая реализация для покупателя (/orders/[id]) и админа (/admin/orders/[id]) —
 * различаются только apiBase и тем, какой sender_type считается «своим» сообщением.
 * Обновление — обычный polling раз в 4с (в проекте нигде не используется Supabase Realtime/WS,
 * вся работа с данными идёт через Next.js API-роуты — держим тот же стиль).
 */

type SenderType = 'user' | 'admin' | 'system'

interface ChatMessage {
  id: string
  sender_type: SenderType
  body: string
  created_at: string
}

interface OrderChatProps {
  apiBase: string
  role: 'user' | 'admin'
}

const POLL_INTERVAL_MS = 4000

export default function OrderChat({ apiBase, role }: OrderChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatExists, setChatExists] = useState(false)
  const [chatStatus, setChatStatus] = useState<'open' | 'closed'>('open')
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    try {
      const res = await fetch(apiBase, { cache: 'no-store' })
      if (res.status === 404) {
        setChatExists(false)
        setMessages([])
        return
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки чата')
      setChatExists(true)
      setChatStatus(data.chat?.status === 'closed' ? 'closed' : 'open')
      setMessages(data.messages || [])
    } catch (e) {
      console.error('Failed to load chat:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  const send = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не удалось отправить сообщение')
      setText('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить сообщение')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="skeleton h-32 rounded-lg" />
      </Card>
    )
  }

  if (!chatExists) {
    return (
      <Card>
        <h2 className="mb-2">Чат с продавцом</h2>
        <p className="text-sm text-muted">Чат появится здесь после оплаты заказа.</p>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="mb-4">Чат с продавцом</h2>

      <div className="flex flex-col gap-2.5 max-h-[420px] overflow-y-auto overflow-x-hidden min-w-0 pr-1 mb-4">
        {messages.length === 0 && <p className="text-sm text-muted">Сообщений пока нет.</p>}
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} own={m.sender_type === role} />
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="alert alert-error mb-3">
          <BI name="info-circle" size="sm" />
          <span>{error}</span>
        </div>
      )}

      {chatStatus === 'closed' ? (
        <p className="text-sm text-muted text-center py-1">Чат закрыт, отправка сообщений недоступна.</p>
      ) : (
        <div className="flex gap-2 items-end">
          <textarea
            className="input flex-1 min-h-[44px] max-h-[120px]"
            rows={1}
            placeholder="Написать сообщение…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="btn btn-primary flex-none" onClick={send} disabled={sending || !text.trim()}>
            {sending ? 'Отправка…' : 'Отправить'}
          </button>
        </div>
      )}
    </Card>
  )
}

function ChatBubble({ message, own }: { message: ChatMessage; own: boolean }) {
  if (message.sender_type === 'system') {
    return (
      <div className="self-center max-w-[85%] text-[12.5px] text-muted bg-blue-50 rounded-lg px-3 py-2 whitespace-pre-wrap break-words text-center">
        {message.body}
      </div>
    )
  }

  return (
    <div
      className={`max-w-[80%] min-w-0 rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${
        own ? 'self-end bg-blue-700 text-white' : 'self-start bg-gray-bg text-ink'
      }`}
    >
      {message.body}
      <div className={`text-[11px] mt-1 ${own ? 'text-blue-100' : 'text-muted-2'}`}>
        {new Date(message.created_at).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    </div>
  )
}
