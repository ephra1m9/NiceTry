// Middleware: защита роутов, трекинг рефералов и UTM-меток.
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const REF_COOKIE = 'nicetry_ref'
const UTM_COOKIE = 'nicetry_utm'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 дней

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // ——— Трекинг рефералов и UTM (до аутентификации, лёгкий) ———
  const url = request.nextUrl
  const ref = url.searchParams.get('ref')
  const utmSource = url.searchParams.get('utm_source')

  if (ref) {
    response.cookies.set(REF_COOKIE, ref, { maxAge: COOKIE_MAX_AGE, httpOnly: false, sameSite: 'lax', path: '/' })
  }
  if (utmSource) {
    const utm: Record<string, string> = {}
    for (const p of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content']) {
      const v = url.searchParams.get(p)
      if (v) utm[p] = v
    }
    response.cookies.set(UTM_COOKIE, JSON.stringify(utm), { maxAge: COOKIE_MAX_AGE, httpOnly: false, sameSite: 'lax', path: '/' })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Защита приватных роутов
  const protectedPaths = ['/profile', '/orders', '/balance']
  if (protectedPaths.some(path => pathname.startsWith(path))) {
    if (!user) {
      const redirectUrl = new URL('/auth/login', request.url)
      redirectUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Защита админских роутов
  if (pathname.startsWith('/admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Проверка роли администратора
    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
