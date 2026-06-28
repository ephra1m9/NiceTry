import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * GET /card_img/[...slug]
 * Раздаёт файлы из uploads/card_img/.
 * Next.js standalone не обслуживает public/ напрямую — поэтому используем route handler.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  // Защита от path traversal
  const filename = params.slug.join('/')
  if (filename.includes('..') || filename.includes('/')) {
    return new NextResponse(null, { status: 400 })
  }

  const filepath = path.join(process.cwd(), 'uploads', 'card_img', filename)

  try {
    const buffer = await readFile(filepath)
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const contentType = MIME[ext] ?? 'application/octet-stream'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
