// Программная регистрация Telegram-бота (ТЗ §5.7): webhook, команды, кнопка-меню Mini App.
//
// Делает ВСЁ через Bot API, без ручных действий в BotFather:
//   1) setWebhook       — приём апдейтов на /api/telegram/webhook с секретом (X-Telegram-Bot-Api-Secret-Token).
//   2) setMyCommands     — список команд бота.
//   3) setChatMenuButton — кнопка возле поля ввода (type=web_app) открывает Mini App с сайтом.
//
// Запуск:
//   node scripts/telegram-setup.mjs                 # настроить по .env.local
//   node scripts/telegram-setup.mjs --url https://host   # переопределить базовый URL сайта
//   node scripts/telegram-setup.mjs --delete         # снять webhook (вернуться к ручному режиму)
//   node scripts/telegram-setup.mjs --info           # только показать getMe + getWebhookInfo

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function loadEnv() {
  try {
    const raw = readFileSync(join(root, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
    }
  } catch {
    /* .env.local может отсутствовать — используем process.env */
  }
}
loadEnv()

const args = process.argv.slice(2)
function argValue(name) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  console.error('ОШИБКА: TELEGRAM_BOT_TOKEN не задан в .env.local')
  process.exit(1)
}

const SITE_URL = (argValue('--url') || process.env.TELEGRAM_WEBAPP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
const WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || `whk_${TOKEN.split(':')[0]}`
const WEBAPP_URL = (process.env.TELEGRAM_WEBAPP_URL || SITE_URL || '').replace(/\/+$/, '') + '/'

const API = `https://api.telegram.org/bot${TOKEN}`

async function call(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!json.ok) throw new Error(`${method}: ${json.description || res.status}`)
  return json.result
}

async function showInfo() {
  const me = await call('getMe', {})
  console.log(`Бот: @${me.username} (id ${me.id}, "${me.first_name}")`)
  const info = await call('getWebhookInfo', {})
  console.log('Webhook:', JSON.stringify(info, null, 2))
}

async function main() {
  if (args.includes('--info')) {
    await showInfo()
    return
  }

  if (args.includes('--delete')) {
    await call('deleteWebhook', { drop_pending_updates: false })
    console.log('✓ Webhook снят (deleteWebhook).')
    await showInfo()
    return
  }

  if (!SITE_URL) {
    console.error('ОШИБКА: не задан TELEGRAM_WEBAPP_URL / NEXT_PUBLIC_SITE_URL и нет --url')
    process.exit(1)
  }
  if (!/^https:\/\//.test(SITE_URL)) {
    console.error(`ОШИБКА: Telegram требует HTTPS для webhook/Mini App. Получено: ${SITE_URL}`)
    console.error('Для локальной отладки используйте туннель (например, ngrok) и --url https://...')
    process.exit(1)
  }

  const webhookUrl = `${SITE_URL}/api/telegram/webhook`

  // 1) Webhook с секретом.
  await call('setWebhook', {
    url: webhookUrl,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  })
  console.log(`✓ setWebhook → ${webhookUrl}`)

  // 2) Команды бота.
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть магазин и меню' },
      { command: 'menu', description: 'Показать меню' },
      { command: 'help', description: 'Справка' },
    ],
  })
  console.log('✓ setMyCommands → /start, /menu, /help')

  // 3) Кнопка-меню (Mini App с сайтом).
  await call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Открыть магазин', web_app: { url: WEBAPP_URL } },
  })
  console.log(`✓ setChatMenuButton (web_app) → ${WEBAPP_URL}`)

  console.log('\nГотово. Текущее состояние:')
  await showInfo()
}

main().catch((e) => {
  console.error('Ошибка настройки бота:', e.message)
  process.exit(1)
})
