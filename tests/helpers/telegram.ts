// Хелперы для тестов Telegram: сборка ПОДПИСАННОГО initData (как это делает Telegram WebApp)
// и стейтовый in-memory фейк supabaseAdmin для account/notify тестов.

import { createHmac } from 'crypto'

/** Собирает валидную строку initData с корректной HMAC-подписью для заданного токена бота. */
export function buildInitData(
  botToken: string,
  user: { id: number; username?: string; first_name?: string },
  opts: { authDate?: number; queryId?: string; extra?: Record<string, string> } = {}
): string {
  const authDate = opts.authDate ?? Math.floor(Date.now() / 1000)
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: opts.queryId ?? 'AAEdummyQueryId',
    user: JSON.stringify(user),
    ...(opts.extra || {}),
  }

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  const params = new URLSearchParams(fields)
  params.set('hash', hash)
  return params.toString()
}

// ───────────────────────────── Стейтовый фейк supabase ─────────────────────────────
//
// Поддерживает реальные таблицы как массивы объектов и фильтрацию по .eq(), что нужно
// для проверки логики единого аккаунта (поиск по telegram_id, привязка, слияние).

interface Row {
  [k: string]: any
}

export class FakeSupabase {
  tables: Record<string, Row[]>
  authUsers: Array<{ id: string; email: string }>
  private seq = 0

  constructor(seed: Record<string, Row[]> = {}) {
    this.tables = {
      users: [],
      orders: [],
      user_statuses: [{ id: 'bronze-id', name: 'Bronze', discount_percent: 0 }],
      reviews: [],
      balance_transactions: [],
      ...seed,
    }
    this.authUsers = []
  }

  private newId(prefix = 'id') {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = []
    return new FakeQuery(this.tables[table], this)
  }

  // Поверхность auth.admin, используемая account.ts/session.ts.
  auth = {
    admin: {
      createUser: async ({ email }: { email: string; email_confirm?: boolean; user_metadata?: any }) => {
        if (this.authUsers.find((u) => u.email === email)) {
          return { data: { user: null }, error: { message: 'A user with this email has already been registered' } }
        }
        const user = { id: this.newId('auth'), email }
        this.authUsers.push(user)
        return { data: { user }, error: null }
      },
      listUsers: async () => ({ data: { users: this.authUsers }, error: null }),
      deleteUser: async (id: string) => {
        this.authUsers = this.authUsers.filter((u) => u.id !== id)
        return { data: {}, error: null }
      },
      generateLink: async ({ email }: { type: string; email: string }) => ({
        data: { properties: { hashed_token: `hashed-${email}` } },
        error: null,
      }),
    },
  }
}

class FakeQuery {
  private filters: Array<{ col: string; val: any; op: string }> = []
  private pendingInsert: Row[] | null = null
  private pendingUpdate: Row | null = null
  private pendingDelete = false
  private limitN: number | null = null

  constructor(private rows: Row[], private db: FakeSupabase) {}

  select() {
    return this
  }
  eq(col: string, val: any) {
    this.filters.push({ col, val, op: 'eq' })
    return this
  }
  neq(col: string, val: any) {
    this.filters.push({ col, val, op: 'neq' })
    return this
  }
  not() {
    return this
  }
  lte() {
    return this
  }
  gte() {
    return this
  }
  order() {
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  insert(payload: Row | Row[]) {
    this.pendingInsert = Array.isArray(payload) ? payload : [payload]
    return this
  }
  update(payload: Row) {
    this.pendingUpdate = payload
    return this
  }
  delete() {
    this.pendingDelete = true
    return this
  }

  private match(row: Row): boolean {
    return this.filters.every((f) => {
      if (f.op === 'eq') return row[f.col] === f.val
      if (f.op === 'neq') return row[f.col] !== f.val
      return true
    })
  }

  private applyWrites(): Row[] {
    if (this.pendingInsert) {
      const inserted: Row[] = []
      for (const r of this.pendingInsert) {
        // Эмулируем UNIQUE(telegram_id) и UNIQUE(email) для users.
        if (this.rows === this.db.tables.users) {
          if (r.telegram_id != null && this.rows.find((x) => x.telegram_id === r.telegram_id)) {
            throw { code: '23505', message: 'duplicate telegram_id' }
          }
          if (r.email && this.rows.find((x) => x.email === r.email)) {
            throw { code: '23505', message: 'duplicate email' }
          }
        }
        const row = { ...r }
        this.rows.push(row)
        inserted.push(row)
      }
      return inserted
    }
    if (this.pendingUpdate) {
      const updated: Row[] = []
      for (const row of this.rows) {
        if (this.match(row)) {
          // UNIQUE(telegram_id) при апдейте.
          if (
            this.rows === this.db.tables.users &&
            this.pendingUpdate.telegram_id != null &&
            this.rows.find((x) => x !== row && x.telegram_id === this.pendingUpdate!.telegram_id)
          ) {
            throw { code: '23505', message: 'duplicate telegram_id' }
          }
          Object.assign(row, this.pendingUpdate)
          updated.push(row)
        }
      }
      return updated
    }
    if (this.pendingDelete) {
      const kept: Row[] = []
      const removed: Row[] = []
      for (const row of this.rows) (this.match(row) ? removed : kept).push(row)
      this.rows.length = 0
      this.rows.push(...kept)
      return removed
    }
    return this.rows.filter((r) => this.match(r))
  }

  private rowsOut(): Row[] {
    try {
      const out = this.applyWrites()
      return this.limitN != null ? out.slice(0, this.limitN) : out
    } catch (e) {
      ;(this as any)._error = e
      return []
    }
  }

  async maybeSingle() {
    const out = this.rowsOut()
    if ((this as any)._error) return { data: null, error: (this as any)._error }
    return { data: out[0] ?? null, error: null }
  }
  async single() {
    const out = this.rowsOut()
    if ((this as any)._error) return { data: null, error: (this as any)._error }
    return { data: out[0] ?? null, error: out[0] ? null : { message: 'not found' } }
  }
  then(resolve: (v: { data: any; error: any }) => unknown, reject?: (e: unknown) => unknown) {
    const out = this.rowsOut()
    const res = (this as any)._error ? { data: null, error: (this as any)._error } : { data: out, error: null }
    return Promise.resolve(res).then(resolve, reject)
  }
}
