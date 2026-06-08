// scripts/apply-db-security.mjs
//
// Применяет supabase_security.sql (и при необходимости другие .sql) к боевой БД.
// Закрывает КРИТИЧЕСКУЮ дыру: без этого шага пользователь может прямым REST-запросом
// (публичный anon-ключ + свой JWT) выставить себе is_admin=true и произвольный balance —
// см. TEST_REPORT.md. PostgREST/service-key НЕ выполняют DDL, поэтому нужен прямой
// Postgres-коннект (пароль БД из дашборда Supabase: Settings → Database).
//
// Запуск (PowerShell):
//   $env:SUPABASE_DB_URL="postgresql://postgres.<ref>:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres"
//   node scripts/apply-db-security.mjs
//
// Флаги:
//   --dry-run         — только распарсить и показать список statements, БЕЗ подключения к БД.
//   <file.sql> ...    — какие файлы применять (по умолчанию supabase_security.sql).
//
// ВАЖНО про "connection timeout" / "upstream connect error":
//   • Прямой хост db.<ref>.supabase.co:5432 на новых проектах — ТОЛЬКО IPv6. С IPv4-сети
//     (типичный Windows-хост) он даёт connection timeout. Используйте Session pooler URI
//     (aws-0-<region>.pooler.supabase.com:5432) — он работает по IPv4.
//   • Free-tier проект засыпает после простоя: первый коннект ловит таймаут, пока БД
//     просыпается. Скрипт сам делает несколько ретраев с паузой — обычно достаточно.
//
// Альтернатива без скрипта: Supabase → SQL Editor → вставить содержимое .sql и выполнить
// (идемпотентно; при таймауте в редакторе разбейте на 2 части — см. FINAL_AUDIT_REPORT).

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ── Подхватываем .env.local (SUPABASE_DB_URL можно хранить там, а не только в $env) ──
try {
  for (const line of readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* .env.local может отсутствовать — используем process.env */
}

// ── Разбор аргументов ──
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const files = argv.filter((a) => !a.startsWith('--'))
const toApply = files.length ? files : ['supabase_security.sql']

/**
 * Разбить SQL-скрипт на отдельные statements по `;`, КОРРЕКТНО игнорируя `;` внутри:
 *   • строковых литералов '...' (с экранированием '');
 *   • dollar-quoted блоков $$ ... $$ или $tag$ ... $tag$ (тела функций!);
 *   • строчных комментариев -- ... \n и блочных /* ... *\/.
 * Без этого тело plpgsql-функции (где есть свои `;`) разрезается неверно.
 */
function splitStatements(sql) {
  const statements = []
  let buf = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)

    // строчный комментарий
    if (two === '--') {
      const nl = sql.indexOf('\n', i)
      const end = nl === -1 ? n : nl
      buf += sql.slice(i, end)
      i = end
      continue
    }
    // блочный комментарий
    if (two === '/*') {
      const close = sql.indexOf('*/', i + 2)
      const end = close === -1 ? n : close + 2
      buf += sql.slice(i, end)
      i = end
      continue
    }
    // одинарная кавычка — строковый литерал
    if (ch === "'") {
      buf += ch
      i++
      while (i < n) {
        buf += sql[i]
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            buf += sql[i + 1]
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }
    // dollar-quote: $tag$ ... $tag$
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/)
      if (m) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        const end = close === -1 ? n : close + tag.length
        buf += sql.slice(i, end)
        i = end
        continue
      }
    }
    // конец statement
    if (ch === ';') {
      const trimmed = buf.trim()
      if (trimmed) statements.push(trimmed)
      buf = ''
      i++
      continue
    }
    buf += ch
    i++
  }
  const tail = buf.trim()
  if (tail) statements.push(tail)
  return statements
}

/** Короткая «шапка» statement для лога (первая значимая строка, без комментариев). */
function label(stmt) {
  const firstLine = stmt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('--'))
  return (firstLine || stmt).slice(0, 72)
}

// ── Dry-run: только парсинг, без БД ──
if (dryRun) {
  let total = 0
  for (const f of toApply) {
    const sql = readFileSync(resolve(root, f), 'utf8')
    const stmts = splitStatements(sql)
    total += stmts.length
    console.log(`\n=== ${f}: ${stmts.length} statements ===`)
    stmts.forEach((s, idx) => console.log(`  ${String(idx + 1).padStart(2)}. ${label(s)}`))
  }
  console.log(`\nИтого: ${total} statements. (--dry-run: к БД не подключались)`)
  process.exit(0)
}

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error(
    'ОШИБКА: переменная SUPABASE_DB_URL не задана.\n' +
      'Возьмите строку подключения в Supabase → Settings → Database → Connection string.\n' +
      'РЕКОМЕНДУЕТСЯ Session pooler (работает по IPv4):\n' +
      '  $env:SUPABASE_DB_URL="postgresql://postgres.<ref>:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres"\n' +
      '  node scripts/apply-db-security.mjs\n' +
      '(проверить разбор без БД: node scripts/apply-db-security.mjs --dry-run)'
  )
  process.exit(1)
}

// ── Предупреждение про IPv6-only прямой хост ──
if (/@db\.[a-z0-9]+\.supabase\.co:/i.test(dbUrl)) {
  console.warn(
    '⚠ Похоже, используется ПРЯМОЙ хост db.<ref>.supabase.co — на новых проектах он только IPv6\n' +
      '  и с IPv4-сети даёт "connection timeout". Если поймаете таймаут — возьмите Session pooler URI\n' +
      '  (aws-0-<region>.pooler.supabase.com:5432) из дашборда и повторите.\n'
  )
}

let pg
try {
  pg = await import('pg')
} catch {
  console.error('Не найден пакет "pg". Установите: npm i -D pg')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Подключение с ретраями (на случай просыпающегося free-tier проекта / транзиентного шлюза). */
async function connectWithRetry() {
  const maxAttempts = 5
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new pg.default.Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
      // 60с на statement — DDL тут мгновенный, но защищаемся от зависшего коннекта.
      statement_timeout: 60_000,
    })
    try {
      await client.connect()
      if (attempt > 1) console.log(`  ✓ подключение установлено (попытка ${attempt})`)
      return client
    } catch (e) {
      lastErr = e
      await client.end().catch(() => {})
      const transient = /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|upstream connect/i.test(
        e.message || ''
      )
      console.error(`  ✗ попытка ${attempt}/${maxAttempts}: ${e.message}`)
      if (!transient || attempt === maxAttempts) break
      const backoff = Math.min(2000 * attempt, 8000)
      console.error(`    повтор через ${backoff / 1000}s (возможно, проект просыпается)...`)
      await sleep(backoff)
    }
  }
  throw lastErr
}

const client = await connectWithRetry()
let failed = false
try {
  for (const f of toApply) {
    const sql = readFileSync(resolve(root, f), 'utf8')
    const stmts = splitStatements(sql)
    console.log(`\nПрименяю ${f} (${stmts.length} statements) ...`)
    // Оборачиваем файл в транзакцию: либо весь применился, либо ничего (атомарно).
    await client.query('BEGIN')
    try {
      for (let idx = 0; idx < stmts.length; idx++) {
        process.stdout.write(`  [${idx + 1}/${stmts.length}] ${label(stmts[idx])} ... `)
        await client.query(stmts[idx])
        console.log('ok')
      }
      await client.query('COMMIT')
      console.log(`  ✓ ${f} применён (COMMIT)`)
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      console.log('FAIL')
      throw e
    }
  }
  console.log('\nГотово. Дыра повышения привилегий закрыта (users_update_own удалён + триггер).')
} catch (e) {
  failed = true
  console.error('\nОшибка применения SQL:', e.message)
  console.error('Изменения этого файла откатаны (ROLLBACK). Скрипт идемпотентен — можно повторить.')
} finally {
  await client.end().catch(() => {})
}
process.exit(failed ? 1 : 0)
