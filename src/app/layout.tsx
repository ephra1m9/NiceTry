import type { Metadata } from 'next'
import Script from 'next/script'
import '../styles/globals.css'
import { AuthProvider } from '@/hooks/useAuth'
import { CartProvider } from '@/hooks/useCart'
import { TelegramProvider } from '@/hooks/useTelegram'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'NiceTry — магазин цифровых товаров',
  description: 'Пополнение игровых аккаунтов, ключи и коды активации, gift-карты, подписки',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230F1E2E'/%3E%3Ctext x='9' y='44' font-family='Arial' font-weight='900' font-size='30' fill='%231C8CE3'%3EN%3C/text%3E%3Ctext x='33' y='44' font-family='Arial' font-weight='900' font-size='30' fill='%23ffffff'%3ET%3C/text%3E%3C/svg%3E",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <head>
        {/* Telegram WebApp SDK — нужен ДО гидратации, чтобы window.Telegram.WebApp был доступен. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="font-sans text-ink bg-bg antialiased flex flex-col min-h-screen">
        <AuthProvider>
          <TelegramProvider>
            <CartProvider>
              <Header />
              <main className="flex-1">
                {children}
              </main>
              <Footer />
            </CartProvider>
          </TelegramProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
