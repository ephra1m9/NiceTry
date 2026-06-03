'use client'

import { useEffect, useState } from 'react'

interface UtmCampaign { id: string; utm_source: string; utm_medium: string; utm_campaign: string; clicks: number; unique_users: number; created_at: string }

export default function AdminUTMPage() {
  const [campaigns, setCampaigns] = useState<UtmCampaign[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/utm')
      .then(res => res.json())
      .then(data => { setCampaigns(data.campaigns || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8">Загрузка...</div>

  return (
    <div className="p-6 max-w-5xl">
      <h2 className="text-xl font-bold mb-4">UTM-кампании</h2>

      {campaigns.length === 0 ? (
        <p className="text-muted">UTM-кликов пока нет. Отправьте трафик с UTM-метками — кампании появятся здесь автоматически.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Источник</th>
                <th>Канал</th>
                <th>Кампания</th>
                <th>Клики</th>
                <th>Уник. пользователи</th>
                <th>Создана</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id}>
                  <td className="font-semibold">{c.utm_source}</td>
                  <td>{c.utm_medium || '—'}</td>
                  <td>{c.utm_campaign || '—'}</td>
                  <td>{c.clicks}</td>
                  <td>{c.unique_users}</td>
                  <td className="text-muted text-sm">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 p-4 bg-navy/5 rounded-lg">
        <h3 className="font-semibold mb-2">Как использовать</h3>
        <p className="text-sm text-muted mb-2">Добавьте UTM-параметры к ссылкам на сайт:</p>
        <code className="text-sm bg-white px-3 py-1.5 rounded block break-all">
          https://nice-try-blush.vercel.app/?utm_source=telegram&utm_medium=post&utm_campaign=launch
        </code>
        <p className="text-sm text-muted mt-2">Клики автоматически запишутся в эту таблицу. UTM-метки сохраняются в cookies на 30 дней.</p>
      </div>
    </div>
  )
}
