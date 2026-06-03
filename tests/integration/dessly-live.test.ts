import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listGames,
  getGame,
  resolvePackage,
  sendGift,
  getTransactionStatus,
  getMerchantBalance,
  isLiveMode,
  isSteamInviteUrl,
  desslyErrorMessage,
  DesslyError,
} from '@/lib/dessly'

// Боевой режим Dessly через СТАБ global.fetch (реальная сеть не используется).
// Проверяем РЕАЛЬНЫЙ контракт (Блок DSL-1, сверено по desslyhub.readme.io):
//   - база https://desslyhub.com, авторизация заголовком apikey (НЕ Bearer);
//   - эндпоинты /api/v1/service/steamgift/* ;
//   - тело sendGift { invite_url, package_id, region, reference };
//   - error_code в теле даже при HTTP 200 → DesslyError;
//   - статус /api/v1/merchants/transaction/{id}/status; баланс GET /api/v1/merchants/balance.

const orig = {
  mock: process.env.NICETRY_FORCE_SUPPLIER_MOCK,
  key: process.env.DESSLY_API_KEY,
  secret: process.env.DESSLY_API_SECRET,
  base: process.env.DESSLY_BASE_URL,
}

beforeEach(() => {
  process.env.NICETRY_FORCE_SUPPLIER_MOCK = '0' // снимаем форс-мок → боевой путь
  process.env.DESSLY_API_KEY = 'test-dessly-key'
  process.env.DESSLY_API_SECRET = 'test-dessly-secret' // боевой режим требует И ключ, И секрет (DSL-3)
  delete process.env.DESSLY_BASE_URL // дефолт https://desslyhub.com
})

afterEach(() => {
  if (orig.mock === undefined) delete process.env.NICETRY_FORCE_SUPPLIER_MOCK
  else process.env.NICETRY_FORCE_SUPPLIER_MOCK = orig.mock
  if (orig.key === undefined) delete process.env.DESSLY_API_KEY
  else process.env.DESSLY_API_KEY = orig.key
  if (orig.secret === undefined) delete process.env.DESSLY_API_SECRET
  else process.env.DESSLY_API_SECRET = orig.secret
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

describe('Dessly: боевой режим — реальный контракт (стаб fetch)', () => {
  it('isLiveMode=true при заданном ключе и снятом форс-моке', () => {
    expect(isLiveMode()).toBe(true)
  })

  it('listGames: GET /api/v1/service/steamgift/games с заголовком apikey, нормализует { games }', async () => {
    const fn = stubFetch({ games: [{ name: 'Cyberpunk 2077', appid: 1091500 }] })
    const games = await listGames()
    expect(games[0].id).toBe('1091500')
    expect(games[0].appid).toBe(1091500)
    expect(games[0].name).toBe('Cyberpunk 2077')
    const [url, opts] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://desslyhub.com/api/v1/service/steamgift/games')
    // Подписанная авторизация: X-Api-Key + X-Timestamp + X-Signature (НЕ apikey, НЕ Bearer).
    expect(opts.headers['X-Api-Key']).toBe('test-dessly-key')
    expect(opts.headers['X-Timestamp']).toMatch(/^\d+$/)
    expect(opts.headers['X-Signature']).toMatch(/^[0-9a-f]{64}$/) // HMAC-SHA256 hex
    expect(opts.headers.apikey).toBeUndefined()
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it('getGame: GET /api/v1/service/steamgift/games/{app_id}, парсит editions + regions_info', async () => {
    const fn = stubFetch({
      game: [
        {
          edition: 'Standard',
          package_id: 555,
          regions_info: [
            { region: 'RU', discount: '94', price: '10', price_original: '60' },
            { region: 'KZ', discount: '0', price: '55', price_original: '55' },
          ],
        },
      ],
    })
    const editions = await getGame('1091500')
    expect(editions).toHaveLength(1)
    expect(editions[0].edition).toBe('Standard')
    expect(editions[0].packageId).toBe(555)
    expect(editions[0].regions[0]).toEqual({ region: 'RU', price: 10, priceOriginal: 60, discount: 94 })
    const [url] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://desslyhub.com/api/v1/service/steamgift/games/1091500')
  })

  it('resolvePackage: по app_id + регион → package_id и цена нужного региона', async () => {
    stubFetch({
      game: [
        {
          edition: 'Standard',
          package_id: 777,
          regions_info: [
            { region: 'RU', discount: '0', price: '10', price_original: '10' },
            { region: 'KZ', discount: '0', price: '55', price_original: '55' },
          ],
        },
      ],
    })
    const pkg = await resolvePackage('1091500', 'KZ')
    expect(pkg).not.toBeNull()
    expect(pkg!.packageId).toBe(777)
    expect(pkg!.price).toBe(55)
    expect(pkg!.region).toBe('KZ')
  })

  it('resolvePackage: недоступный регион → null', async () => {
    stubFetch({
      game: [{ edition: 'Standard', package_id: 1, regions_info: [{ region: 'RU', price: '1', price_original: '1', discount: '0' }] }],
    })
    expect(await resolvePackage('1091500', 'ZZ')).toBeNull()
  })

  it('sendGift: POST /api/v1/service/steamgift/sendgames, тело { invite_url, package_id, region, reference }', async () => {
    const fn = stubFetch({ transaction_id: 'tx1', status: 'pending', error_code: 0 })
    const res = await sendGift({
      inviteUrl: 'https://s.team/p/abcd-1234',
      packageId: 555,
      region: 'RU',
      reference: 'ref-1',
    })
    expect(res.transactionId).toBe('tx1')
    expect(res.status).toBe('pending')
    const [url, opts] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://desslyhub.com/api/v1/service/steamgift/sendgames')
    expect(opts.method).toBe('POST')
    expect(opts.headers['X-Api-Key']).toBe('test-dessly-key')
    expect(opts.headers['X-Signature']).toMatch(/^[0-9a-f]{64}$/)
    expect(opts.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(opts.body)
    expect(body).toEqual({
      invite_url: 'https://s.team/p/abcd-1234',
      // package_id уходит строкой — Dessly OpenAPI типизирует поле как string.
      package_id: '555',
      region: 'RU',
      reference: 'ref-1',
    })
    // НЕ должно быть старых полей.
    expect(body.app_id).toBeUndefined()
    expect(body.recipient).toBeUndefined()
    expect(body.sub_id).toBeUndefined()
  })

  it('sendGift: status "success" → sent', async () => {
    stubFetch({ transaction_id: 'tx2', status: 'success', error_code: 0 })
    const res = await sendGift({ inviteUrl: 'https://s.team/p/x', packageId: 1, region: 'RU' })
    expect(res.status).toBe('sent')
  })

  it('error_code < 0 в ТЕЛЕ при HTTP 200 → DesslyError с кодом и сообщением', async () => {
    // Реальный кейс: провал отдаётся error_code, даже если status="success".
    stubFetch({ status: 'success', error_code: -55 })
    try {
      await sendGift({ inviteUrl: 'https://s.team/p/x', packageId: 1, region: 'RU' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DesslyError)
      expect((e as DesslyError).code).toBe(-55)
      expect((e as DesslyError).message).toBe('У получателя уже есть эта игра')
    }
  })

  it('getTransactionStatus: GET /api/v1/merchants/transaction/{id}/status; failed → failed', async () => {
    const fn = stubFetch({ status: 'failed' })
    const res = await getTransactionStatus('tx1')
    expect(res.status).toBe('failed')
    const [url] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://desslyhub.com/api/v1/merchants/transaction/tx1/status')
  })

  it('getTransactionStatus: cancelled → failed (деньги возвращены поставщиком)', async () => {
    stubFetch({ status: 'cancelled' })
    const res = await getTransactionStatus('tx9')
    expect(res.status).toBe('failed')
  })

  it('getMerchantBalance: GET /api/v1/merchants/balance, balance-строка → число', async () => {
    const fn = stubFetch({ balance: '1.0000' })
    const bal = await getMerchantBalance()
    expect(bal.balance).toBe(1)
    const [url, opts] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://desslyhub.com/api/v1/merchants/balance')
    expect(opts.method).toBe('GET')
  })

  it('HTTP-ошибка с error_code в теле → DesslyError несёт код', async () => {
    stubFetch({ error_code: -5 }, false, 403)
    try {
      await listGames()
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DesslyError)
      expect((e as DesslyError).code).toBe(-5)
      expect((e as DesslyError).status).toBe(403)
    }
  })

  it('DESSLY_BASE_URL переопределяет базу', async () => {
    process.env.DESSLY_BASE_URL = 'https://stage.desslyhub.com'
    const fn = stubFetch({ games: [] })
    await listGames()
    const [url] = fn.mock.calls[0] as unknown as [string, any]
    expect(url).toBe('https://stage.desslyhub.com/api/v1/service/steamgift/games')
  })
})

describe('desslyErrorMessage — карта кодов', () => {
  it('известные коды → русские сообщения', () => {
    expect(desslyErrorMessage(-2)).toContain('Недостаточно средств')
    expect(desslyErrorMessage(-51)).toContain('добавления в друзья')
    expect(desslyErrorMessage(-58)).toContain('Регион получателя')
  })
  it('неизвестный код → дефолт с номером', () => {
    expect(desslyErrorMessage(-9999)).toContain('-9999')
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
