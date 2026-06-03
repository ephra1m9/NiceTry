import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listGames,
  sendGift,
  getTransactionStatus,
  getMerchantBalance,
  isLiveMode,
  isSteamInviteUrl,
  DesslyError,
} from '@/lib/dessly'

// Боевой режим Dessly через СТАБ global.fetch (реальная сеть не используется).
// Проверяем: Bearer-авторизацию, эндпоинты, форму тела и нормализацию ответов — то поведение,
// что включается при вставленном DESSLY_API_KEY (Блок B1 + деградация/боевой режим D1).

const orig = {
  mock: process.env.NICETRY_FORCE_SUPPLIER_MOCK,
  key: process.env.DESSLY_API_KEY,
  base: process.env.DESSLY_BASE_URL,
}

beforeEach(() => {
  process.env.NICETRY_FORCE_SUPPLIER_MOCK = '0' // снимаем форс-мок → боевой путь
  process.env.DESSLY_API_KEY = 'test-dessly-key'
  process.env.DESSLY_BASE_URL = 'https://api.desslyhub.com'
})

afterEach(() => {
  if (orig.mock === undefined) delete process.env.NICETRY_FORCE_SUPPLIER_MOCK
  else process.env.NICETRY_FORCE_SUPPLIER_MOCK = orig.mock
  if (orig.key === undefined) delete process.env.DESSLY_API_KEY
  else process.env.DESSLY_API_KEY = orig.key
  if (orig.base === undefined) delete process.env.DESSLY_BASE_URL
  else process.env.DESSLY_BASE_URL = orig.base
  vi.unstubAllGlobals()
})

function stubFetch(jsonBody: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('Dessly: боевой режим (стаб fetch)', () => {
  it('isLiveMode=true при заданном ключе и снятом форс-моке', () => {
    expect(isLiveMode()).toBe(true)
  })

  it('listGames: GET /api/v1/steam/games с Bearer-заголовком, нормализует ответ', async () => {
    const fn = stubFetch({ items: [{ id: 730, name: 'CS2', price: 0, currency: 'USD', platform: 'Steam' }] })
    const games = await listGames()
    expect(games[0].id).toBe('730')
    expect(games[0].name).toBe('CS2')
    const [url, opts] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://api.desslyhub.com/api/v1/steam/games')
    expect(opts.headers.Authorization).toBe('Bearer test-dessly-key')
  })

  it('sendGift: POST /api/v1/steam/gift, тело с app_id/recipient(invite)/reference_id (+region/sub_id)', async () => {
    const fn = stubFetch({ transaction_id: 'tx1', status: 'sent', gift_link: 'https://store.steampowered.com/gift/x' })
    const res = await sendGift({
      gameId: '730',
      recipient: 'https://s.team/p/abcd-1234',
      referenceId: 'ref-1',
      region: 'RU',
      edition: 'sub_999',
    })
    expect(res.transactionId).toBe('tx1')
    expect(res.status).toBe('sent')
    expect(res.giftLink).toContain('store.steampowered.com')
    const [url, opts] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://api.desslyhub.com/api/v1/steam/gift')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(opts.body)
    expect(body.app_id).toBe('730')
    expect(body.recipient).toBe('https://s.team/p/abcd-1234')
    expect(body.reference_id).toBe('ref-1')
    expect(body.region).toBe('RU')
    expect(body.sub_id).toBe('sub_999')
  })

  it('getTransactionStatus: GET /api/v1/status/{id}', async () => {
    const fn = stubFetch({ status: 'pending' })
    const res = await getTransactionStatus('tx1')
    expect(res.status).toBe('pending')
    const [url] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://api.desslyhub.com/api/v1/status/tx1')
  })

  it('getMerchantBalance: PUT /api/v1/merchants/balance', async () => {
    const fn = stubFetch({ balance: 500, currency: 'USD' })
    const bal = await getMerchantBalance()
    expect(bal.balance).toBe(500)
    const [url, opts] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://api.desslyhub.com/api/v1/merchants/balance')
    expect(opts.method).toBe('PUT')
  })

  it('ошибка API (ok=false) → DesslyError со статусом', async () => {
    stubFetch({ error: 'bad invite' }, false, 422)
    await expect(
      sendGift({ gameId: '730', recipient: 'https://s.team/p/x', referenceId: 'r' })
    ).rejects.toBeInstanceOf(DesslyError)
  })
})

describe('isSteamInviteUrl — валидация ссылки-приглашения', () => {
  it('принимает корректные s.team / steamcommunity ссылки', () => {
    expect(isSteamInviteUrl('https://s.team/p/abcd-1234')).toBe(true)
    expect(isSteamInviteUrl('https://s.team/p/fkne-rktw/XYZ123')).toBe(true)
    expect(isSteamInviteUrl('https://steamcommunity.com/p/abcd-1234')).toBe(true)
  })
  it('отклоняет некорректные', () => {
    expect(isSteamInviteUrl('http://s.team/p/abcd')).toBe(false) // не https
    expect(isSteamInviteUrl('https://example.com/p/abcd')).toBe(false)
    expect(isSteamInviteUrl('https://steamcommunity.com/id/profilename')).toBe(false)
    expect(isSteamInviteUrl('')).toBe(false)
    expect(isSteamInviteUrl('просто текст')).toBe(false)
  })
})
