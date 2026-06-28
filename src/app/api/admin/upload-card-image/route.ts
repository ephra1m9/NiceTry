import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * POST /api/admin/upload-card-image
 * Принимает multipart/form-data с полем "file".
 * Сохраняет в public/card_img/<timestamp>-<sanitized-name>.
 * Возвращает { url: "/card_img/..." }.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.response

    const formData = await request.formData().catch(() => null)
    if (!formData) return NextResponse.json({ error: 'Не удалось прочитать форму' }, { status: 400 })

    const file = formData.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Допустимые форматы: JPEG, PNG, WebP, GIF' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Файл слишком большой. Максимум 5 МБ' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const baseName = file.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40)
    const filename = `${Date.now()}-${baseName}.${ext}`

    // Храним в uploads/card_img/ — вне public/, т.к. Next.js standalone не раздаёт public/ напрямую.
    // Файлы отдаются через route handler /card_img/[...slug]/route.ts.
    const uploadDir = path.join(process.cwd(), 'uploads', 'card_img')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, filename), buffer)

    return NextResponse.json({ url: `/card_img/${filename}` })
  } catch (error: any) {
    console.error('[upload-card-image]', error)
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки' }, { status: 500 })
  }
}
