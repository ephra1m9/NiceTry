// Лёгкий in-memory rate-limiter (скользящее окно) для защиты роутов от флуда.
//
// ВАЖНО про serverless: на Vercel/Fluid Compute счётчик живёт в памяти инстанса и НЕ
// делится между инстансами. Это осознанный компромисс: зависимостей (Redis/Upstash) не
// тянем, а отдельный инстанс под нагрузкой всё равно перестаёт быть бесконечным усилителем.
// Для денежных/критичных операций основная защита — HMAC-подписи и проверки прав; лимитер
// здесь — дополнительный барьер против дешёвого флуда (генерация сессий/OTP, спам кодами).
//
// Окно — простой массив таймстампов на ключ; устаревшие записи вычищаются лениво при обращении
// и периодическим свипом, чтобы Map не рос неограниченно.

interface Bucket {
  hits: number[] // отсортированные по возрастанию таймстампы (мс)
}

const buckets = new Map<string, Bucket>()

// Периодический свип пустых/протухших корзин (защита от утечки памяти при множестве ключей).
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let lastSweep = 0

function sweep(now: number, windowMs: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  for (const [key, b] of buckets) {
    const cutoff = now - windowMs
    b.hits = b.hits.filter((t) => t > cutoff)
    if (b.hits.length === 0) buckets.delete(key)
  }
}

export interface RateLimitResult {
  /** true — запрос разрешён; false — лимит исчерпан. */
  ok: boolean
  /** Сколько ещё запросов доступно в текущем окне (для заголовков). */
  remaining: number
  /** Через сколько секунд освободится слот (для Retry-After), когда ok=false. */
  retryAfterSec: number
}

/**
 * Проверить и учесть запрос по ключу.
 * @param key      Стабильный идентификатор (например `auth:<telegram_id>` или `claim:<user_id>`).
 * @param limit    Максимум запросов в окне.
 * @param windowMs Размер окна в миллисекундах.
 * @param now      Текущее время (мс). Параметризуемо для детерминированных тестов.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  sweep(now, windowMs)
  const cutoff = now - windowMs
  let b = buckets.get(key)
  if (!b) {
    b = { hits: [] }
    buckets.set(key, b)
  }
  // Отбрасываем всё, что вышло за окно.
  if (b.hits.length && b.hits[0] <= cutoff) {
    b.hits = b.hits.filter((t) => t > cutoff)
  }

  if (b.hits.length >= limit) {
    const oldest = b.hits[0]
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
    return { ok: false, remaining: 0, retryAfterSec }
  }

  b.hits.push(now)
  return { ok: true, remaining: limit - b.hits.length, retryAfterSec: 0 }
}

/** Тестовый помощник: полностью сбросить состояние лимитера. */
export function __resetRateLimit(): void {
  buckets.clear()
  lastSweep = 0
}

/** Достать client-IP из заголовков прокси (Vercel проставляет x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return headers.get('x-real-ip') || 'unknown'
}
