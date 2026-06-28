'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/hooks/useUser'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import TelegramLinkCard from '@/components/TelegramLinkCard'
import OrdersSection from '@/components/OrdersSection'
import ProxyOrdersSection from '@/components/ProxyOrdersSection'
import TelegramOrdersSection from '@/components/TelegramOrdersSection'
import EsimOrdersSection from '@/components/EsimOrdersSection'
import { BI } from '@/components/ui/BI'

function initials(email?: string): string {
  if (!email) return 'NT'
  return email.split('@')[0].slice(0, 2).toUpperCase()
}

export default function ProfilePage() {
  const { user: authUser, loading: authLoading } = useAuth()
  const { user, loading: userLoading, refetch } = useUser()
  const [copied, setCopied] = useState(false)

  if (authLoading || userLoading) {
    return (
      <div className="container py-8">
        <Spinner label="Загрузка профиля…" />
      </div>
    )
  }

  if (!authUser || !user) {
    return (
      <div className="container py-10">
        <div className="empty-state card max-w-lg mx-auto">
          <div className="ico">
            <BI name="person" />
          </div>
          <h3>Пользователь не найден</h3>
          <p>Похоже, сессия истекла. Войдите снова, чтобы открыть профиль.</p>
          <a href="/auth/login" className="btn btn-primary mt-1">Войти</a>
        </div>
      </div>
    )
  }

  const refLink = `${process.env.NEXT_PUBLIC_SITE_URL || ''}/?ref=${user.referral_code}`
  const copy = () => {
    navigator.clipboard.writeText(refLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="container py-6 sm:py-8">
      {/* Шапка профиля */}
      <div className="flex items-center gap-4 mb-6">
        <span
          className="flex items-center justify-center w-16 h-16 rounded-full text-white text-xl font-bold flex-none"
          style={{ background: 'linear-gradient(135deg,var(--blue),var(--blue-800))' }}
        >
          {initials(user.email)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate">{user.nickname || user.email}</h1>
          {user.nickname && <p className="text-sm text-muted truncate">{user.email}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="amber">{user.status?.name || 'Bronze'}</Badge>
            {user.status?.discount_percent > 0 && (
              <span className="text-sm text-muted">персональная скидка {user.status.discount_percent}%</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Баланс */}
        <Card>
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2>Баланс</h2>
            <BI name="credit-card" className="text-blue-700" />
          </div>
          <div className="text-[34px] leading-none font-extrabold text-navy mb-5 mt-2">
            {new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(user.balance)} ₽
          </div>
          <Button variant="primary" block>Пополнить баланс</Button>
        </Card>

        {/* Основная информация */}
        <Card>
          <h2 className="mb-4">Основная информация</h2>
          <dl className="divide-y divide-border-2">
            <div className="flex items-center justify-between py-2.5 gap-3">
              <dt className="text-sm text-muted">Никнейм</dt>
              <dd className="font-medium text-navy truncate">
                {user.nickname || (
                  <a href="/auth/login?step=nickname" className="text-blue-700">Выбрать ник</a>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2.5 gap-3">
              <dt className="text-sm text-muted">Email</dt>
              <dd className="font-medium text-navy truncate">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 gap-3">
              <dt className="text-sm text-muted">Реферальный код</dt>
              <dd className="font-mono font-medium text-navy">{user.referral_code}</dd>
            </div>
            {user.telegram_id && (
              <div className="flex items-center justify-between py-2.5 gap-3">
                <dt className="text-sm text-muted">Telegram ID</dt>
                <dd className="font-medium text-navy">{user.telegram_id}</dd>
              </div>
            )}
            <div className="flex items-center justify-between py-2.5 gap-3">
              <dt className="text-sm text-muted">Дата регистрации</dt>
              <dd className="font-medium text-navy">{new Date(user.created_at).toLocaleDateString('ru-RU')}</dd>
            </div>
          </dl>
        </Card>

        {/* Привязка Telegram (единый аккаунт) */}
        <TelegramLinkCard
          telegramId={user.telegram_id}
          telegramUsername={(user as { telegram_username?: string | null }).telegram_username}
          onChanged={refetch}
        />

        {/* Реферальная программа */}
        <Card className="md:col-span-2">
          <h2 className="mb-2">Реферальная программа</h2>
          <p className="text-sm text-muted mb-4">
            Приглашайте друзей и получайте бонусы — поделитесь своей персональной ссылкой.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="text" value={refLink} readOnly aria-label="Реферальная ссылка" className="input flex-1 font-mono text-[13px]" />
            <Button variant={copied ? 'secondary' : 'primary'} onClick={copy} className="sm:w-auto">
              {copied ? (
                <>
                  <BI name="check-lg" size="sm" />
                  Скопировано
                </>
              ) : (
                <>
                  <BI name="copy" size="sm" />
                  Копировать
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* Заказы */}
        <OrdersSection />

        {/* Купленные прокси px6 (раздел скрывается, если их нет) */}
        <ProxyOrdersSection />

        {/* Заявки на Telegram Stars/Premium (раздел скрывается, если их нет) */}
        <TelegramOrdersSection />

        {/* Купленные eSIM (раздел скрывается, если их нет) */}
        <EsimOrdersSection />
      </div>
    </div>
  )
}
