// Клиент Telegram Bot API: вызовы методов с ретраями, таймаутами и понятной обработкой ошибок.
//
// Надёжность (ТЗ §5.7, §6): сетевые сбои и 429 (flood limit) повторяются с backoff;
// 403 (пользователь заблокировал бота) и прочие 4xx — терминальные, не повторяются.

import { BOT_TOKEN } from './config'

const API_BASE = 'https://api.telegram.org'

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public errorCode: number,
    public description: string,
    public retryAfter?: number
  ) {
    super(message)
    this.name = 'TelegramApiError'
  }

  /** Пользователь заблокировал бота / чат недоступен — уведомление слать бессмысленно. */
  get isBlocked(): boolean {
    return (
      this.errorCode === 403 ||
      /bot was blocked|user is deactivated|chat not found|bot can't initiate/i.test(this.description)
    )
  }
}

interface CallOpts {
  token?: string
  timeoutMs?: number
  attempts?: number
  signal?: AbortSignal
}

/** Низкоуровневый вызов метода Bot API. Бросает TelegramApiError при ошибке поставщика. */
export async function callTelegram<T = any>(
  method: string,
  payload: Record<string, unknown> = {},
  opts: CallOpts = {}
): Promise<T> {
  const token = opts.token ?? BOT_TOKEN
  if (!token) throw new TelegramApiError('TELEGRAM_BOT_TOKEN не задан', 0, 'no_token')

  const attempts = opts.attempts ?? 3
  const timeoutMs = opts.timeoutMs ?? 10_000
  const url = `${API_BASE}/bot${token}/${method}`

  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    // Прокидываем внешний AbortSignal (если есть).
    if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
      const json: any = await res.json().catch(() => ({}))

      if (json?.ok) return json.result as T

      const errorCode: number = json?.error_code ?? res.status
      const description: string = json?.description ?? `HTTP ${res.status}`
      const retryAfter: number | undefined = json?.parameters?.retry_after

      // 429 — flood limit: ждём retry_after и повторяем.
      if (errorCode === 429 && i < attempts - 1) {
        await sleep((retryAfter ?? 1) * 1000)
        continue
      }
      // Прочие 4xx (включая 403 blocked) — терминальны, не повторяем.
      throw new TelegramApiError(`Telegram ${method} failed: ${description}`, errorCode, description, retryAfter)
    } catch (e) {
      // Сетевой сбой/таймаут (не TelegramApiError) — повторяем с backoff.
      if (e instanceof TelegramApiError) throw e
      lastErr = e
      if (i < attempts - 1) await sleep(300 * (i + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new TelegramApiError(
    `Telegram ${method} network error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    0,
    'network_error'
  )
}

// ───────────────────────────── высокоуровневые методы ─────────────────────────────

export interface InlineButton {
  text: string
  url?: string
  callback_data?: string
  web_app?: { url: string }
}

export function sendMessage(
  chatId: number | string,
  text: string,
  opts: {
    reply_markup?: { inline_keyboard: InlineButton[][] }
    parse_mode?: 'HTML' | 'MarkdownV2'
    disable_web_page_preview?: boolean
    token?: string
  } = {}
) {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts.parse_mode ?? 'HTML',
    disable_web_page_preview: opts.disable_web_page_preview ?? true,
    reply_markup: opts.reply_markup,
  }, { token: opts.token })
}

export function sendPhoto(
  chatId: number | string,
  photo: string,
  opts: { caption?: string; reply_markup?: { inline_keyboard: InlineButton[][] }; token?: string } = {}
) {
  return callTelegram('sendPhoto', {
    chat_id: chatId,
    photo,
    caption: opts.caption,
    parse_mode: 'HTML',
    reply_markup: opts.reply_markup,
  }, { token: opts.token })
}

export function answerCallbackQuery(
  callbackQueryId: string,
  opts: { text?: string; show_alert?: boolean; token?: string } = {}
) {
  return callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: opts.text,
    show_alert: opts.show_alert ?? false,
  }, { token: opts.token })
}

export function setMyCommands(commands: Array<{ command: string; description: string }>, opts: { token?: string } = {}) {
  return callTelegram('setMyCommands', { commands }, { token: opts.token })
}

export function setChatMenuButton(webAppUrl: string, text = 'Открыть магазин', opts: { token?: string } = {}) {
  return callTelegram('setChatMenuButton', {
    menu_button: { type: 'web_app', text, web_app: { url: webAppUrl } },
  }, { token: opts.token })
}

export function setWebhook(
  url: string,
  opts: { secretToken?: string; allowedUpdates?: string[]; token?: string } = {}
) {
  return callTelegram('setWebhook', {
    url,
    secret_token: opts.secretToken,
    allowed_updates: opts.allowedUpdates ?? ['message', 'callback_query'],
    drop_pending_updates: false,
  }, { token: opts.token })
}

export function deleteWebhook(opts: { dropPending?: boolean; token?: string } = {}) {
  return callTelegram('deleteWebhook', { drop_pending_updates: opts.dropPending ?? false }, { token: opts.token })
}

export function getWebhookInfo(opts: { token?: string } = {}) {
  return callTelegram('getWebhookInfo', {}, { token: opts.token })
}

export function getMe(opts: { token?: string } = {}) {
  return callTelegram('getMe', {}, { token: opts.token })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
