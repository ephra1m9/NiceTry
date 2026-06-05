// Отправка одноразовых кодов входа через Resend (https://api.resend.com).
//
// Почему fetch, а не SDK: проект уже общается со всеми внешними API через fetch (AppRoute,
// Dessly, px6) — тянуть зависимость `resend` ради одного POST не нужно. Resend SDK сам ставит
// User-Agent; при «голом» fetch ставим свой явный User-Agent, иначе Resend может ответить 403/1010.
//
// Ключ берём ТОЛЬКО из process.env.RESEND_API_KEY — не хардкодим.
// Поведение без ключа:
//   - dev (NODE_ENV !== 'production'): НЕ падаем, печатаем код в консоль (можно тестировать вход
//     без боевого ключа), возвращаем { ok: true, dev: true }.
//   - production: внятно падаем (throw), чтобы не делать вид, что письмо ушло.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Тема письма. */
const SUBJECT = 'Ваш код для входа в NiceTry'

export interface SendAuthCodeResult {
  ok: boolean
  /** true — код не отправлен письмом, а выведен в консоль (dev без ключа). */
  dev?: boolean
  /** id письма от Resend (если отправлено). */
  id?: string
}

/** Ошибка отправки кода. `kind` помогает роуту выбрать HTTP-ответ/сообщение пользователю. */
export class ResendSendError extends Error {
  constructor(
    public kind: 'no_key' | 'rate_limit' | 'invalid_config' | 'server' | 'unknown',
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'ResendSendError'
  }
}

function ttlMinutes(): number {
  const raw = Number(process.env.AUTH_CODE_TTL_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10
}

function fromAddress(): string {
  // По умолчанию — брендовый отправитель. На проде требует верифицированного домена в Resend.
  return process.env.RESEND_FROM || 'NiceTry <noreply@nicetry.guru>'
}

/** Светлый бело-голубой брендовый HTML-шаблон письма с кодом. */
function buildHtml(code: string, ttlMin: number): string {
  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f8fd;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8fd;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e3eef8;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;text-align:center;">
          <div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;">
            <span style="color:#1C8CE3;">Nice</span><span style="color:#0F1E2E;">Try</span>
          </div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;text-align:center;">
          <h1 style="margin:12px 0 4px;font-size:19px;color:#0F1E2E;">Код для входа</h1>
          <p style="margin:0;font-size:14px;color:#6b7d90;">Введите этот код на странице входа</p>
        </td></tr>
        <tr><td style="padding:20px 32px;text-align:center;">
          <div style="display:inline-block;background:#eef6fe;border:1px solid #cfe6fb;border-radius:12px;padding:16px 28px;">
            <span style="font-size:34px;font-weight:800;letter-spacing:8px;color:#1C8CE3;font-family:'Courier New',monospace;">${code}</span>
          </div>
        </td></tr>
        <tr><td style="padding:0 32px 24px;text-align:center;">
          <p style="margin:0;font-size:13px;color:#6b7d90;">Код действует ${ttlMin} мин. Никому его не сообщайте.</p>
          <p style="margin:10px 0 0;font-size:12px;color:#a4b3c2;">Если вы не запрашивали вход — просто проигнорируйте это письмо.</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#a4b3c2;">© NiceTry · nicetry.guru</p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildText(code: string, ttlMin: number): string {
  return `Ваш код для входа в NiceTry: ${code}\nКод действует ${ttlMin} мин. Никому его не сообщайте.\nЕсли вы не запрашивали вход — проигнорируйте это письмо.`
}

/**
 * Отправить код входа на почту.
 * @param email      Почта получателя (уже нормализованная в нижний регистр).
 * @param code       6-значный код (открытый — только для письма, в БД хранится хеш).
 * @param idempotencyId  Стабильный идентификатор кода (id строки auth_codes) — для Idempotency-Key,
 *                       чтобы ретраи не слали дубль письма (Resend хранит ключ 24ч).
 */
export async function sendAuthCode(
  email: string,
  code: string,
  idempotencyId?: string,
): Promise<SendAuthCodeResult> {
  const apiKey = process.env.RESEND_API_KEY
  const ttlMin = ttlMinutes()
  const isProduction = process.env.NODE_ENV === 'production'

  // Нет ключа: dev — печатаем код и выходим; prod — внятная ошибка.
  if (!apiKey) {
    if (!isProduction) {
      // eslint-disable-next-line no-console
      console.warn(`[resend] RESEND_API_KEY не задан — код для ${email}: ${code} (dev-режим, письмо не отправлено)`)
      return { ok: true, dev: true }
    }
    throw new ResendSendError('no_key', 'RESEND_API_KEY не задан в production — письма не отправляются')
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    // Resend без User-Agent может вернуть 403/1010 — ставим явный.
    'User-Agent': 'nicetry-auth/1.0',
  }
  if (idempotencyId) {
    headers['Idempotency-Key'] = `auth-code/${email}/${idempotencyId}`.slice(0, 256)
  }

  let res: Response
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: fromAddress(),
        to: [email],
        subject: SUBJECT,
        html: buildHtml(code, ttlMin),
        text: buildText(code, ttlMin),
      }),
      cache: 'no-store',
    })
  } catch (e) {
    // Сетевой сбой соединения — считаем временным (5xx-класс), роут попросит повторить позже.
    throw new ResendSendError('server', `Сетевая ошибка при обращении к Resend: ${(e as Error).message}`)
  }

  if (res.ok) {
    const data = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: data?.id }
  }

  // Разбираем ошибку Resend.
  const body = (await res.json().catch(() => null)) as { name?: string; message?: string } | null
  const msg = body?.message || body?.name || `Resend error ${res.status}`

  if (res.status === 429) {
    throw new ResendSendError('rate_limit', msg, 429)
  }
  if (res.status === 401 || res.status === 403 || res.status === 422) {
    // 401 missing_api_key, 403 invalid_api_key/validation_error (домен не верифицирован),
    // 422 invalid_from_address. Это конфигурационные проблемы — пользователю «попробуйте позже»,
    // в логи — подробность для администратора.
    // eslint-disable-next-line no-console
    console.error(`[resend] config/auth error ${res.status}: ${msg}`)
    throw new ResendSendError('invalid_config', msg, res.status)
  }
  if (res.status >= 500) {
    throw new ResendSendError('server', msg, res.status)
  }
  throw new ResendSendError('unknown', msg, res.status)
}
