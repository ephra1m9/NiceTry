// Логика бота: разбор апдейтов, команды и кнопки (ТЗ §5.7).
//
// Webhook-роут лишь проверяет секрет и вызывает processUpdate(). Здесь — вся бизнес-логика:
//   • /start [token] — приветствие + документы + меню; deep-link токен привязывает аккаунт сайта.
//   • /help          — список команд.
//   • Меню: Открыть магазин (Mini App), Мои заказы, Код привязки, Отзывы, Поддержка.
//   • Идемпотентность: обработчики безопасны к повтору (Telegram может прислать апдейт дважды) —
//     привязка идемпотентна, ответы-сообщения безвредны при дубле.

import {
  sendMessage,
  answerCallbackQuery,
  TelegramApiError,
  type InlineButton,
} from './client'
import { WEBAPP_URL, SUPPORT_URL, REVIEWS_URL, BOT_USERNAME } from './config'
import { createTgClaimCode, verifySiteLinkToken, type TelegramUser } from './verify'
import { ensureTelegramUser, findUserByTelegramId, linkTelegramToUser } from './account'

// ── типы апдейта (минимально необходимое) ──
interface TgChat { id: number; type?: string }
interface TgMessage {
  message_id: number
  from?: TelegramUser
  chat: TgChat
  text?: string
}
interface TgCallbackQuery {
  id: string
  from: TelegramUser
  message?: TgMessage
  data?: string
}
export interface TgUpdate {
  update_id?: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}

const OFFER_URL = joinUrl(WEBAPP_URL, 'offer')
const PRIVACY_URL = joinUrl(WEBAPP_URL, 'privacy')

/** Главное меню (ТЗ §5.7). «Открыть магазин» и «Мои заказы» — Mini App с сайтом. */
function mainMenu(): InlineButton[][] {
  return [
    [{ text: '🛍 Открыть магазин', web_app: { url: WEBAPP_URL } }],
    [{ text: '🧾 Мои заказы', web_app: { url: joinUrl(WEBAPP_URL, 'profile') } }],
    [{ text: '🔗 Код привязки', callback_data: 'link_code' }],
    [
      { text: '⭐️ Отзывы', url: REVIEWS_URL },
      { text: '🆘 Поддержка', url: SUPPORT_URL },
    ],
  ]
}

function greeting(name?: string): string {
  const hi = name ? `, ${escapeHtml(name)}` : ''
  return [
    `👋 Привет${hi}! Это <b>NiceTry</b> — магазин цифровых товаров.`,
    '',
    'Здесь можно покупать ключи, gift-карты и пополнения прямо в Telegram.',
    'Нажмите <b>«Открыть магазин»</b>, чтобы войти в витрину — вход выполнится автоматически.',
    '',
    `📄 Пользуясь ботом и магазином, вы соглашаетесь с <a href="${OFFER_URL}">офертой</a> и <a href="${PRIVACY_URL}">политикой конфиденциальности</a>.`,
  ].join('\n')
}

/** Точка входа: обработать один апдейт. Никогда не бросает — логирует и возвращает. */
export async function processUpdate(update: TgUpdate): Promise<void> {
  try {
    if (update.message) return await handleMessage(update.message)
    if (update.callback_query) return await handleCallback(update.callback_query)
  } catch (e) {
    // Любая ошибка обработчика не должна валить webhook (иначе Telegram будет ретраить вечно).
    console.error('[telegram] processUpdate error:', e instanceof Error ? e.message : e)
  }
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const from = msg.from
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()

  // Команды.
  if (text.startsWith('/start')) {
    const param = text.slice('/start'.length).trim()
    return await handleStart(chatId, from, param)
  }
  if (text.startsWith('/help')) {
    return void (await safeSend(chatId, helpText(), mainMenu()))
  }
  if (text.startsWith('/menu')) {
    return void (await safeSend(chatId, 'Меню NiceTry:', mainMenu()))
  }
  if (text.startsWith('/link')) {
    const param = text.slice('/link'.length).trim()
    if (param) return await handleStart(chatId, from, param)
    return void (await safeSend(chatId, 'Чтобы привязать аккаунт сайта, откройте профиль на сайте и нажмите «Привязать Telegram».', mainMenu()))
  }

  // Прочий текст — показываем меню (бот не диалоговый).
  await safeSend(chatId, 'Используйте меню ниже 👇', mainMenu())
}

async function handleStart(chatId: number, from: TelegramUser | undefined, param: string): Promise<void> {
  if (!from) return void (await safeSend(chatId, greeting(), mainMenu()))

  // Гарантируем аккаунт (telegram-first) — чтобы Mini App сразу авторизовал того же пользователя.
  try {
    await ensureTelegramUser(from)
  } catch (e) {
    console.error('[telegram] ensureTelegramUser:', e instanceof Error ? e.message : e)
  }

  // Deep-link привязки аккаунта сайта: /start <site-link-token>.
  if (param) {
    const verified = verifySiteLinkToken(param)
    if (!verified.ok) {
      const why =
        verified.reason === 'expired'
          ? 'Ссылка привязки истекла. Сгенерируйте новую в профиле на сайте.'
          : 'Ссылка привязки недействительна.'
      await safeSend(chatId, `⚠️ ${why}`, mainMenu())
      return
    }
    const res = await linkTelegramToUser(verified.userId, from)
    if (res.ok) {
      await safeSend(
        chatId,
        res.merged
          ? '✅ Telegram привязан к вашему аккаунту сайта. Покупки, баланс и заказы теперь общие.'
          : '✅ Telegram успешно привязан к вашему аккаунту. Теперь сайт, бот и Mini App — это один аккаунт.',
        mainMenu()
      )
    } else if (res.reason === 'conflict') {
      await safeSend(
        chatId,
        '⚠️ Этот Telegram уже привязан к другому аккаунту. Отвяжите его там или войдите под нужным аккаунтом на сайте.',
        mainMenu()
      )
    } else {
      await safeSend(chatId, '⚠️ Аккаунт для привязки не найден. Повторите из профиля на сайте.', mainMenu())
    }
    return
  }

  await safeSend(chatId, greeting(from.first_name), mainMenu())
}

async function handleCallback(cb: TgCallbackQuery): Promise<void> {
  const data = cb.data || ''
  const chatId = cb.message?.chat.id ?? cb.from.id

  if (data === 'link_code') {
    // Код для привязки Telegram к существующему аккаунту сайта (вводится на сайте в профиле).
    const code = createTgClaimCode(cb.from.id)
    await answerCb(cb.id)
    await safeSend(
      chatId,
      [
        '🔗 <b>Код привязки Telegram</b>',
        '',
        'Откройте профиль на сайте → «Привязать Telegram по коду» и вставьте:',
        '',
        `<code>${code}</code>`,
        '',
        '⏱ Код действует 15 минут.',
      ].join('\n')
    )
    return
  }

  if (data === 'docs_ack') {
    await answerCb(cb.id, 'Спасибо! Приятных покупок 🛍')
    return
  }

  await answerCb(cb.id)
}

function helpText(): string {
  return [
    '<b>Команды NiceTry</b>',
    '',
    '/start — открыть магазин и меню',
    '/menu — показать меню',
    '/help — эта справка',
    '',
    `Бот: @${escapeHtml(BOT_USERNAME)}`,
  ].join('\n')
}

// ── обёртки, гасящие ошибки доставки ──
async function safeSend(chatId: number, text: string, menu?: InlineButton[][]): Promise<void> {
  try {
    await sendMessage(chatId, text, menu ? { reply_markup: { inline_keyboard: menu } } : {})
  } catch (e) {
    if (e instanceof TelegramApiError && e.isBlocked) return
    console.error('[telegram] safeSend:', e instanceof Error ? e.message : e)
  }
}
async function answerCb(id: string, text?: string): Promise<void> {
  try {
    await answerCallbackQuery(id, text ? { text } : {})
  } catch {
    /* проглатываем */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Реэкспорт для удобства вызывающих.
export { findUserByTelegramId }
