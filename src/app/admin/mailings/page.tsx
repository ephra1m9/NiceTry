'use client'

import { useEffect, useState } from 'react'

interface Mailing { id: string; title: string; message: string; segment: string; status: string; sent_count: number; created_at: string }

export default function AdminMailingsPage() {
  const [mailings, setMailings] = useState<Mailing[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [btnText, setBtnText] = useState('')
  const [btnUrl, setBtnUrl] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<string | null>(null)

  const fetchMailings = async () => {
    const res = await fetch('/api/admin/mailings')
    const data = await res.json()
    setMailings(data.mailings || [])
    setLoading(false)
  }

  useEffect(() => { fetchMailings() }, [])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !message.trim()) return
    setSending(true); setError(''); setSent(null)
    const res = await fetch('/api/admin/mailings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        message: message.trim(),
        image_url: imageUrl.trim() || null,
        button_text: btnText.trim() || null,
        button_url: btnUrl.trim() || null,
        segment: 'all',
      }),
    })
    if (res.ok) {
      setSent(`Рассылка «${title.trim()}» запущена!`)
      setTitle(''); setMessage(''); setImageUrl(''); setBtnText(''); setBtnUrl('')
      await fetchMailings()
    } else {
      const e = await res.json(); setError(e.error)
    }
    setSending(false)
  }

  const statusLabel = (s: string) => ({ draft: 'Черновик', scheduled: 'Запланирована', sending: 'Отправляется', completed: 'Завершена' } as Record<string, string>)[s] || s

  if (loading) return <div className="p-8">Загрузка...</div>

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-bold mb-4">Рассылки в Telegram</h2>

      <form onSubmit={send} className="bg-navy/5 p-4 rounded-lg mb-6 grid gap-3">
        <input className="input" placeholder="Название рассылки" value={title} onChange={e => setTitle(e.target.value)} required />
        <textarea className="input" rows={3} placeholder="Текст сообщения (HTML)" value={message} onChange={e => setMessage(e.target.value)} required />
        <div className="grid sm:grid-cols-2 gap-3">
          <input className="input" placeholder="URL картинки (необяз.)" value={imageUrl} onChange={e => setImageUrl(e.target.value)} />
          <input className="input" placeholder="Текст кнопки (необяз.)" value={btnText} onChange={e => setBtnText(e.target.value)} />
          <input className="input" placeholder="Ссылка кнопки (необяз.)" value={btnUrl} onChange={e => setBtnUrl(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={sending} type="submit">
          {sending ? 'Запускаем...' : 'Отправить всем подписчикам бота'}
        </button>
        {sent && <p className="text-green-600 text-sm">{sent}</p>}
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </form>

      {mailings.length === 0 ? (
        <p className="text-muted">Рассылок пока нет.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Название</th>
                <th>Статус</th>
                <th>Отправлено</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {mailings.map(m => (
                <tr key={m.id}>
                  <td className="font-semibold">{m.title}</td>
                  <td>{statusLabel(m.status)}</td>
                  <td>{m.sent_count}</td>
                  <td className="text-muted text-sm">{new Date(m.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
