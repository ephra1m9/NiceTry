import Link from 'next/link'
import { LEGAL } from '@/lib/legal'

/** Ссылки на страницы юридических документов — единый источник для футера и меню. */
export const LEGAL_LINKS = [
  { href: '/offer', label: 'Публичная оферта' },
  { href: '/privacy', label: 'Политика конфиденциальности' },
  { href: '/refunds', label: 'Политика возвратов' },
  { href: '/contacts', label: 'Обратная связь' },
] as const

export default function Footer() {
  return (
    <footer className="site-footer bg-white border-t border-border mt-auto">
      <div className="container py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* О проекте */}
          <div>
            <h4 className="font-bold text-navy mb-3">{LEGAL.siteName}</h4>
            <p className="text-sm text-muted">
              Магазин цифровых товаров с моментальной доставкой
            </p>
          </div>

          {/* Каталог */}
          <div>
            <h4 className="font-bold text-navy mb-3">Каталог</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/catalog" className="text-muted hover:text-blue transition-colors">
                  Все товары
                </Link>
              </li>
              <li>
                <Link href="/catalog?type=instant" className="text-muted hover:text-blue transition-colors">
                  Моментальные
                </Link>
              </li>
              <li>
                <Link href="/catalog?type=topup" className="text-muted hover:text-blue transition-colors">
                  Пополнения
                </Link>
              </li>
            </ul>
          </div>

          {/* Документы */}
          <div>
            <h4 className="font-bold text-navy mb-3">Документы</h4>
            <ul className="space-y-2 text-sm">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-muted hover:text-blue transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Поддержка */}
          <div>
            <h4 className="font-bold text-navy mb-3">Поддержка</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="https://t.me/nicetry_support" className="text-muted hover:text-blue transition-colors">
                  Telegram
                </a>
              </li>
              <li>
                <a href={`mailto:${LEGAL.email}`} className="text-muted hover:text-blue transition-colors">
                  {LEGAL.email}
                </a>
              </li>
              <li>
                <Link href="/contacts" className="text-muted hover:text-blue transition-colors">
                  Контакты
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border text-center text-sm text-muted">
          <p>&copy; {new Date().getFullYear()} {LEGAL.siteName}. Все права защищены.</p>
        </div>
      </div>
    </footer>
  )
}
