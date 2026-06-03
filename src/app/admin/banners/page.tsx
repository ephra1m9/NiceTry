'use client'

import { useEffect, useState } from 'react'

interface Banner { id: string; title: string; image_url: string; link_url?: string; is_active: boolean; sort_order: number }

export default function AdminBannersPage() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchBanners = async () => {
    const res = await fetch('/api/admin/banners')
    const data = await res.json()
    setBanners(data.banners || [])
    setLoading(false)
  }

  useEffect(() => { fetchBanners() }, [])

  const addBanner = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !imageUrl.trim()) return
    setSaving(true); setError('')
    const res = await fetch('/api/admin/banners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), image_url: imageUrl.trim(), link_url: linkUrl.trim() || null }),
    })
    if (res.ok) { setTitle(''); setImageUrl(''); setLinkUrl(''); await fetchBanners() }
    else { const e = await res.json(); setError(e.error) }
    setSaving(false)
  }

  const toggleActive = async (b: Banner) => {
    await fetch(`/api/admin/banners/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !b.is_active }),
    })
    await fetchBanners()
  }

  const remove = async (id: string) => {
    if (!confirm('Удалить баннер?')) return
    await fetch(`/api/admin/banners/${id}`, { method: 'DELETE' })
    await fetchBanners()
  }

  if (loading) return <div className="p-8">Загрузка...</div>

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-bold mb-4">Баннеры на главной</h2>

      <form onSubmit={addBanner} className="bg-navy/5 p-4 rounded-lg mb-6 grid gap-3 sm:grid-cols-3">
        <input className="input" placeholder="Заголовок" value={title} onChange={e => setTitle(e.target.value)} required />
        <input className="input" placeholder="URL картинки" value={imageUrl} onChange={e => setImageUrl(e.target.value)} required />
        <input className="input" placeholder="Ссылка (необяз.)" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} />
        <button className="btn btn-primary" disabled={saving} type="submit">Добавить</button>
        {error && <p className="text-red-600 text-sm col-span-3">{error}</p>}
      </form>

      {banners.length === 0 ? (
        <p className="text-muted">Баннеров пока нет.</p>
      ) : (
        <div className="grid gap-3">
          {banners.map(b => (
            <div key={b.id} className={`flex items-center gap-4 p-3 rounded-lg border ${b.is_active ? 'border-green/30 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
              <img src={b.image_url} alt={b.title} className="w-20 h-14 object-cover rounded" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{b.title}</div>
                {b.link_url && <div className="text-xs text-muted truncate">{b.link_url}</div>}
              </div>
              <button className={`btn btn-sm ${b.is_active ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleActive(b)}>
                {b.is_active ? 'Активен' : 'Скрыт'}
              </button>
              <button className="btn btn-sm btn-ghost text-red-600" onClick={() => remove(b.id)}>Удалить</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
