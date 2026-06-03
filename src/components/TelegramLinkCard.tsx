'use client'

import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'

/**
 * Привязка Telegram в профиле (ТЗ §5.2) — «в обе стороны»:
 *   • Через бота: получаем deep-link t.me/<bot>?start=<token> и открываем его (бот привяжет).
 *   • По коду:    вставляем код, который бот выдаёт по кнопке «Код привязки».
 * Конфликт привязки (Telegram уже у другого аккаунта) показывается предупреждением.
 */
export default function TelegramLinkCard({
  telegramId,
  telegramUsername,
  onChanged,
}: {
  telegramId?: number | string | null
  telegramUsername?: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const linked = Boolean(telegramId)

  const linkViaBot = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/telegram/link-token', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не удалось получить ссылку')
      window.open(data.url, '_blank', 'noopener')
      setMsg({ type: 'ok', text: 'Открыли бота — подтвердите привязку в Telegram и вернитесь сюда.' })
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка' })
    } finally {
      setBusy(false)
    }
  }

  const linkByCode = async () => {
    if (!code.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/telegram/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не удалось привязать')
      setMsg({ type: 'ok', text: 'Telegram успешно привязан.' })
      setCode('')
      onChanged()
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка' })
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id: '' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Не удалось отвязать')
      }
      setMsg({ type: 'ok', text: 'Telegram отвязан.' })
      onChanged()
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Ошибка' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="md:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2>Telegram</h2>
        {linked ? <Badge variant="stock">привязан</Badge> : <Badge variant="amber">не привязан</Badge>}
      </div>

      {linked ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Аккаунт привязан{telegramUsername ? <> — <span className="font-medium text-navy">@{telegramUsername}</span></> : null}.
            Бот, сайт и Mini App работают с одним аккаунтом.
          </p>
          <Button variant="ghost" onClick={unlink} disabled={busy} className="sm:w-auto">
            Отвязать
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted mb-4">
            Привяжите Telegram, чтобы получать уведомления о заказах и входить в Mini App автоматически.
          </p>
          <div className="flex flex-col gap-3">
            <Button variant="primary" onClick={linkViaBot} disabled={busy} className="sm:w-auto">
              Привязать через бота
            </Button>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Код привязки из бота"
                aria-label="Код привязки из бота"
                className="input flex-1 font-mono text-[13px]"
              />
              <Button variant="secondary" onClick={linkByCode} disabled={busy || !code.trim()} className="sm:w-auto">
                Привязать по коду
              </Button>
            </div>
          </div>
        </>
      )}

      {msg && (
        <p className={`text-sm mt-3 ${msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>
      )}
    </Card>
  )
}
