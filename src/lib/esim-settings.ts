// Настройки витрины eSIM (/esim): наценка%, курс USD→₽, вкл/выкл — синглтон esim_settings
// (как proxy_settings/telegram_settings), НЕ общая таблица categories. eSIM не лежит в каталоге
// товаров (variant/тариф приходят от Dessly на лету, цена динамическая, см. lib/dessly.ts),
// поэтому markup/rate сюда не подходят как обычная категория — отдельная настройка нужнее.

import { supabaseAdmin } from '@/lib/supabase/admin'

export interface EsimSettings {
  markup_percent: number
  usd_to_rub_rate: number
  is_enabled: boolean
}

export const DEFAULT_ESIM_SETTINGS: EsimSettings = {
  markup_percent: 20,
  usd_to_rub_rate: 82,
  is_enabled: true,
}

/** Настройки eSIM из БД (admin-editable) с фолбэком на дефолты. */
export async function loadEsimSettings(): Promise<EsimSettings> {
  try {
    const { data } = await supabaseAdmin
      .from('esim_settings')
      .select('markup_percent, usd_to_rub_rate, is_enabled')
      .eq('id', 1)
      .maybeSingle()
    if (!data) return { ...DEFAULT_ESIM_SETTINGS }
    return {
      markup_percent: Number(data.markup_percent ?? DEFAULT_ESIM_SETTINGS.markup_percent),
      usd_to_rub_rate: Number(data.usd_to_rub_rate ?? DEFAULT_ESIM_SETTINGS.usd_to_rub_rate),
      is_enabled: data.is_enabled !== false,
    }
  } catch {
    return { ...DEFAULT_ESIM_SETTINGS }
  }
}
