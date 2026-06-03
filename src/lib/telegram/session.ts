// Выдача серверной сессии Supabase по email пользователя — без отправки письма.
//
// Тот же приём, что в /api/auth/dev-login: service-role генерирует одноразовый token_hash
// (generateLink почту НЕ шлёт), затем серверный клиент подтверждает его (verifyOtp) и пишет
// сессионные cookies. Используется для авто-входа из Mini App после проверки initData
// и для входа из бота по коду привязки — пользователь оказывается залогинен тем же аккаунтом,
// что и на сайте (единый аккаунт, ТЗ §5.7).

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function issueSessionForEmail(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkError || !linkData?.properties?.hashed_token) {
    return { ok: false, error: linkError?.message || 'Не удалось сгенерировать токен сессии' }
  }

  const supabase = await createClient()
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token,
  })
  if (verifyError) return { ok: false, error: verifyError.message }

  return { ok: true }
}
