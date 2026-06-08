import { describe, it, expect } from 'vitest'
import {
  STEAM_REGIONS,
  DEFAULT_REGION,
  findRegion,
  getSteamTopupConfig,
  commissionRub,
  chargeRub,
  normalizeSteamAccount,
  isValidSteamAccount,
  validateTopup,
} from '@/lib/steam-topup'

describe('steam-topup: регионы', () => {
  it('RU — регион по умолчанию и первый в списке', () => {
    expect(DEFAULT_REGION).toBe('RU')
    expect(STEAM_REGIONS[0].code).toBe('RU')
  })

  it('findRegion без учёта регистра, неизвестный → undefined', () => {
    expect(findRegion('kz')?.code).toBe('KZ')
    expect(findRegion('RU')?.label).toBe('Россия')
    expect(findRegion('zz')).toBeUndefined()
    expect(findRegion(null)).toBeUndefined()
  })
})

describe('steam-topup: конфиг из env', () => {
  it('дефолты при пустом env', () => {
    const cfg = getSteamTopupConfig({})
    expect(cfg).toEqual({ min: 100, max: 50000, commissionPercent: 3 })
  })

  it('читает значения из env и чинит max < min', () => {
    const cfg = getSteamTopupConfig({
      STEAM_TOPUP_MIN: '200',
      STEAM_TOPUP_MAX: '100', // меньше min → подтягивается до min
      STEAM_TOPUP_COMMISSION_PERCENT: '5',
    })
    expect(cfg.min).toBe(200)
    expect(cfg.max).toBe(200)
    expect(cfg.commissionPercent).toBe(5)
  })

  it('игнорирует мусор/неположительные значения', () => {
    const cfg = getSteamTopupConfig({ STEAM_TOPUP_MIN: 'abc', STEAM_TOPUP_MAX: '-5', STEAM_TOPUP_COMMISSION_PERCENT: '0' })
    expect(cfg).toEqual({ min: 100, max: 50000, commissionPercent: 3 })
  })
})

describe('steam-topup: комиссия и итог', () => {
  it('комиссия 3% округляется до рубля', () => {
    expect(commissionRub(1000, 3)).toBe(30)
    expect(commissionRub(333, 3)).toBe(10) // 9.99 → 10
    expect(commissionRub(0, 3)).toBe(0)
    expect(commissionRub(-5, 3)).toBe(0)
  })

  it('итог к оплате = сумма + комиссия', () => {
    expect(chargeRub(1000, 3)).toBe(1030)
    expect(chargeRub(2000, 3)).toBe(2060)
    expect(chargeRub(100, 3)).toBe(103)
  })
})

describe('steam-topup: логин', () => {
  it('нормализация: пробелы и ведущий @', () => {
    expect(normalizeSteamAccount('  player_1 ')).toBe('player_1')
    expect(normalizeSteamAccount('@gamer')).toBe('gamer')
    expect(normalizeSteamAccount(null)).toBe('')
  })

  it('валидация логина', () => {
    expect(isValidSteamAccount('player_2024')).toBe(true)
    expect(isValidSteamAccount('a.b-c_1')).toBe(true)
    expect(isValidSteamAccount('x')).toBe(false) // слишком коротко
    expect(isValidSteamAccount('has space')).toBe(false)
    expect(isValidSteamAccount('кириллица')).toBe(false)
    expect(isValidSteamAccount('')).toBe(false)
  })
})

describe('steam-topup: validateTopup', () => {
  const cfg = getSteamTopupConfig({})

  it('успех: нормализует и считает суммы', () => {
    const r = validateTopup({ account: ' @player_1 ', region: 'kz', amount: '1000' }, cfg)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.account).toBe('player_1')
      expect(r.value.region.code).toBe('KZ')
      expect(r.value.steamAmount).toBe(1000)
      expect(r.value.commission).toBe(30)
      expect(r.value.charge).toBe(1030)
    }
  })

  it('пустой/битый логин → ошибка', () => {
    expect(validateTopup({ account: '', region: 'RU', amount: 1000 }, cfg).ok).toBe(false)
    expect(validateTopup({ account: 'has space', region: 'RU', amount: 1000 }, cfg).ok).toBe(false)
  })

  it('неизвестный регион → дефолтный RU (не ошибка)', () => {
    const r = validateTopup({ account: 'player_1', region: 'zz', amount: 1000 }, cfg)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.region.code).toBe('RU')
  })

  it('сумма вне лимитов → ошибка', () => {
    expect(validateTopup({ account: 'player_1', region: 'RU', amount: 50 }, cfg).ok).toBe(false)
    expect(validateTopup({ account: 'player_1', region: 'RU', amount: 99999 }, cfg).ok).toBe(false)
    expect(validateTopup({ account: 'player_1', region: 'RU', amount: 0 }, cfg).ok).toBe(false)
    expect(validateTopup({ account: 'player_1', region: 'RU', amount: 'abc' }, cfg).ok).toBe(false)
  })

  it('границы лимитов включительно', () => {
    expect(validateTopup({ account: 'player_1', region: 'RU', amount: cfg.min }, cfg).ok).toBe(true)
    expect(validateTopup({ account: 'player_1', region: 'RU', amount: cfg.max }, cfg).ok).toBe(true)
  })
})
