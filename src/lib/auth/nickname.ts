// Правила и валидация никнейма.
// Ник: латиница, цифры, `_`, `-`; длина 3–20. Уникальность — регистронезависимо (в БД через
// частичный UNIQUE-индекс LOWER(nickname), см. migrations/auth_resend.sql).

export const NICKNAME_MIN = 3
export const NICKNAME_MAX = 20
const NICKNAME_RE = /^[A-Za-z0-9_-]+$/

export interface NicknameValidation {
  ok: boolean
  /** Сообщение об ошибке для пользователя (когда ok=false). */
  error?: string
}

/** Проверить формат ника (без проверки занятости — это делает БД). */
export function validateNickname(raw: string): NicknameValidation {
  const nick = (raw ?? '').trim()
  if (nick.length < NICKNAME_MIN) {
    return { ok: false, error: `Минимум ${NICKNAME_MIN} символа` }
  }
  if (nick.length > NICKNAME_MAX) {
    return { ok: false, error: `Максимум ${NICKNAME_MAX} символов` }
  }
  if (!NICKNAME_RE.test(nick)) {
    return { ok: false, error: 'Только латиница, цифры, _ и -' }
  }
  return { ok: true }
}
