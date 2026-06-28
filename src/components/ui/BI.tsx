interface BIProps {
  name: string
  size?: 'sm' | 'lg' | 'xl'
  className?: string
}

/** Bootstrap Icons font icon. Класс .ic управляет размером (18px по умолчанию). */
export function BI({ name, size, className = '' }: BIProps) {
  const sizeClass = size === 'sm' ? ' ic-sm' : size === 'lg' ? ' ic-lg' : size === 'xl' ? ' ic-xl' : ''
  return <i className={`bi bi-${name} ic${sizeClass}${className ? ' ' + className : ''}`} aria-hidden="true" />
}
