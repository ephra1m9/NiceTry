import { describe, it, expect } from 'vitest'
import {
  listEsimVariants,
  getEsimVariant,
  createEsimOrder,
  getEsimOrderStatus,
  esimPackageBucket,
} from '@/lib/dessly'
import { randomUUID } from 'crypto'

// Мок-режим Dessly eSIM (DESSLY_API_KEY — плейсхолдер / форс-мок), данные из catalog.json (desslyEsim).

describe('Dessly eSIM: бакет вкладки по типу пакета', () => {
  it('data → "только интернет"', () => {
    expect(esimPackageBucket('data')).toBe('data')
    expect(esimPackageBucket('')).toBe('data')
  })
  it('voice/sms/call в строке → "интернет, звонки, смс"', () => {
    expect(esimPackageBucket('data_voice_sms')).toBe('data_voice_sms')
    expect(esimPackageBucket('DATA_VOICE')).toBe('data_voice_sms')
    expect(esimPackageBucket('data_sms')).toBe('data_voice_sms')
    expect(esimPackageBucket('call')).toBe('data_voice_sms')
  })
})

describe('Dessly eSIM: каталог пакетов (мок)', () => {
  it('listEsimVariants возвращает пакеты обоих типов', async () => {
    const { variants } = await listEsimVariants()
    expect(variants.length).toBeGreaterThan(0)
    const tr = variants.find((v) => v.id === 'esim_tr_data')
    expect(tr).toBeDefined()
    expect(tr!.country).toBe('TR')
    expect(esimPackageBucket(tr!.packageType)).toBe('data')
    const globalVoice = variants.find((v) => v.id === 'esim_global_voice')
    expect(globalVoice).toBeDefined()
    expect(globalVoice!.country).toBeFalsy()
    expect(esimPackageBucket(globalVoice!.packageType)).toBe('data_voice_sms')
  })

  it('getEsimVariant возвращает тарифы пакета', async () => {
    const detail = await getEsimVariant('esim_tr_data')
    expect(detail).not.toBeNull()
    expect(detail!.plans.length).toBeGreaterThan(0)
    expect(detail!.plans[0].price).toBeGreaterThan(0)
  })

  it('getEsimVariant несуществующего пакета → null', async () => {
    expect(await getEsimVariant('nope')).toBeNull()
  })
})

describe('Dessly eSIM: покупка (мок)', () => {
  it('createEsimOrder возвращает transactionId и статус sent', async () => {
    const reference = randomUUID()
    const res = await createEsimOrder({ variantId: 'esim_tr_data', productId: 'plan_tr_data_1gb', reference })
    expect(res.status).toBe('sent')
    expect(res.transactionId).toBeTruthy()
  })

  it('getEsimOrderStatus возвращает данные активации', async () => {
    const res = await getEsimOrderStatus('dessly-esim-xyz')
    expect(['pending', 'sent', 'failed']).toContain(res.status)
    expect(res.qrCodeText).toBeTruthy()
    expect(res.smdpAddress).toBeTruthy()
  })
})
