'use client'

interface Region {
  value: string
  label: string
}

interface RegionTabsProps {
  regions: Region[]
  selected: string
  onChange: (value: string) => void
}

// Эмодзи для кодов без стандартного флага ISO 3166-1
const EMOJI_FLAGS: Record<string, string> = {
  GLOBAL: '🌐',
  CIS: '🌍',
}

// UK → GB для ISO 3166-1 (flagcdn.com использует стандартные коды)
function FlagImg({ code }: { code: string }) {
  if (EMOJI_FLAGS[code]) {
    return (
      <span aria-hidden="true" className="text-base leading-none flex-none">
        {EMOJI_FLAGS[code]}
      </span>
    )
  }
  const iso = (code === 'UK' ? 'GB' : code).toLowerCase()
  return (
    <img
      src={`https://flagcdn.com/w20/${iso}.png`}
      srcSet={`https://flagcdn.com/w40/${iso}.png 2x`}
      width={20}
      height={15}
      alt=""
      aria-hidden="true"
      className="rounded-[2px] object-cover flex-none"
    />
  )
}

export function RegionTabs({ regions, selected, onChange }: RegionTabsProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-5">
      <button
        type="button"
        onClick={() => onChange('')}
        className={`inline-flex items-center px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
          selected === ''
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'bg-surface border-border text-ink hover:border-blue-500 hover:text-blue-700'
        }`}
      >
        Все регионы
      </button>
      {regions.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onChange(selected === r.value ? '' : r.value)}
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
            selected === r.value
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-surface border-border text-ink hover:border-blue-500 hover:text-blue-700'
          }`}
        >
          <FlagImg code={r.value} />
          {r.label}
        </button>
      ))}
    </div>
  )
}
