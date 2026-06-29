'use client'

import { useState, useRef } from 'react'

export function ImageUploadField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/upload-card-image', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Ошибка загрузки'); return }
      onChange(data.url)
    } catch {
      setError('Ошибка сети')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {value && (
          <img
            src={value}
            alt=""
            style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }}
          />
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn btn-ghost btn-sm"
          style={{ whiteSpace: 'nowrap' }}
        >
          {uploading ? 'Загрузка…' : value ? '↻ Заменить' : '↑ Загрузить'}
        </button>
        {value && (
          <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {value}
          </span>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--muted)', padding: '0 4px', flexShrink: 0 }}
            title="Удалить изображение"
          >
            ✕
          </button>
        )}
      </div>
      {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}
