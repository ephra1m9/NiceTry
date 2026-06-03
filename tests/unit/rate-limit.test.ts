import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, __resetRateLimit, clientIp } from '@/lib/rate-limit'

describe('rateLimit — скользящее окно (Блок 10 аудита)', () => {
  beforeEach(() => __resetRateLimit())

  it('пропускает до лимита, затем отбивает 429-сигналом', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++) {
      const r = rateLimit('k', 3, 1000, t0 + i)
      expect(r.ok).toBe(true)
    }
    const blocked = rateLimit('k', 3, 1000, t0 + 4)
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  it('окно скользит: после истечения старых хитов снова пускает', () => {
    const t0 = 2_000_000
    rateLimit('k', 2, 1000, t0)
    rateLimit('k', 2, 1000, t0 + 100)
    expect(rateLimit('k', 2, 1000, t0 + 200).ok).toBe(false)
    // Сдвигаемся за пределы окна (>1000мс от первого хита).
    expect(rateLimit('k', 2, 1000, t0 + 1101).ok).toBe(true)
  })

  it('разные ключи независимы', () => {
    const t0 = 3_000_000
    expect(rateLimit('a', 1, 1000, t0).ok).toBe(true)
    expect(rateLimit('a', 1, 1000, t0 + 1).ok).toBe(false)
    // Другой ключ не затронут.
    expect(rateLimit('b', 1, 1000, t0 + 1).ok).toBe(true)
  })

  it('remaining корректно уменьшается', () => {
    const t0 = 4_000_000
    expect(rateLimit('k', 3, 1000, t0).remaining).toBe(2)
    expect(rateLimit('k', 3, 1000, t0 + 1).remaining).toBe(1)
    expect(rateLimit('k', 3, 1000, t0 + 2).remaining).toBe(0)
  })

  it('clientIp берёт первый адрес из x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4')
    expect(clientIp(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
