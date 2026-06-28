interface AlertProps {
  children: React.ReactNode
  variant?: 'info' | 'success' | 'error' | 'warn'
  className?: string
}

const ICONS: Record<NonNullable<AlertProps['variant']>, string> = {
  info: 'info-circle',
  success: 'check-lg',
  error: 'exclamation-triangle',
  warn: 'exclamation-triangle',
}

/** Единый блок уведомления (заменяет разнобой inline-сообщений). */
export default function Alert({ children, variant = 'info', className = '' }: AlertProps) {
  return (
    <div className={`alert alert-${variant} ${className}`.trim()} role="alert">
      <i className={`bi bi-${ICONS[variant]} ic ic-sm`} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
