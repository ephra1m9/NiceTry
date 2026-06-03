'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Минимальная типизация Telegram WebApp SDK (то, что используем).
interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id: number; username?: string; first_name?: string } }
  colorScheme?: 'light' | 'dark'
  themeParams?: Record<string, string>
  viewportHeight?: number
  isExpanded?: boolean
  ready: () => void
  expand: () => void
  disableVerticalSwipes?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void }
  MainButton?: {
    setText: (t: string) => void
    show: () => void
    hide: () => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
    enable: () => void
    disable: () => void
  }
  HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (t: string) => void }
}

type TelegramContextType = {
  isTelegram: boolean
  webApp: TelegramWebApp | null
  authState: 'idle' | 'authenticating' | 'authenticated' | 'error' | 'not-telegram'
}

const TelegramContext = createContext<TelegramContextType>({
  isTelegram: false,
  webApp: null,
  authState: 'idle',
})

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)
  const [authState, setAuthState] = useState<TelegramContextType['authState']>('idle')
  const router = useRouter()
  const pathname = usePathname()
  const authTriedRef = useRef(false)

  // Инициализация SDK + авто-авторизация по initData (один раз за загрузку).
  useEffect(() => {
    const tg = window.Telegram?.WebApp
    if (!tg || !tg.initData) {
      setAuthState('not-telegram')
      return
    }
    setWebApp(tg)

    // Готовность + растягивание окна на всю высоту, отметка темы для адаптивных стилей.
    try {
      tg.ready()
      tg.expand()
      tg.disableVerticalSwipes?.()
      document.documentElement.classList.add('tg-webapp')
      if (tg.colorScheme === 'dark') document.documentElement.classList.add('tg-dark')
    } catch {
      /* SDK может отсутствовать частично — не критично */
    }

    if (authTriedRef.current) return
    authTriedRef.current = true

    // Авто-вход: отправляем подписанный initData на сервер (проверка HMAC там).
    setAuthState('authenticating')
    fetch('/api/telegram/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then(async (res) => {
        if (res.ok) {
          setAuthState('authenticated')
          tg.HapticFeedback?.notificationOccurred('success')
          // Сессионные cookies уже установлены ответом. Если middleware ранее увёл нас на
          // /auth/login (защищённый роут открыт до появления сессии) — возвращаемся на
          // целевую страницу. Иначе просто обновляем серверные компоненты.
          const { pathname, search } = window.location
          if (pathname.startsWith('/auth/login')) {
            const target = new URLSearchParams(search).get('redirect') || '/'
            router.replace(target)
          } else {
            router.refresh()
          }
        } else {
          setAuthState('error')
        }
      })
      .catch(() => setAuthState('error'))
  }, [router])

  // BackButton Telegram: показываем на внутренних страницах, прячем на главной.
  useEffect(() => {
    const tg = webApp
    if (!tg?.BackButton) return
    const onBack = () => router.back()
    if (pathname && pathname !== '/') {
      tg.BackButton.show()
      tg.BackButton.onClick(onBack)
    } else {
      tg.BackButton.hide()
    }
    return () => tg.BackButton?.offClick(onBack)
  }, [pathname, webApp, router])

  return (
    <TelegramContext.Provider value={{ isTelegram: Boolean(webApp), webApp, authState }}>
      {children}
    </TelegramContext.Provider>
  )
}

export const useTelegram = () => useContext(TelegramContext)
