# Инструкция по развёртыванию Supabase

## Шаг 1: Создание проекта в Supabase

1. Перейдите на https://supabase.com
2. Войдите или зарегистрируйтесь
3. Создайте новый проект:
   - **Name:** NiceTry
   - **Database Password:** (сохраните в надёжном месте)
   - **Region:** выберите ближайший к РФ (например, Frankfurt)
   - **Pricing Plan:** Free (для старта)

4. Дождитесь создания проекта (~2 минуты)

## Шаг 2: Применение схемы БД

1. В панели Supabase откройте **SQL Editor**
2. Создайте новый запрос
3. Скопируйте содержимое файла `supabase_schema.sql`
4. Вставьте в редактор и нажмите **Run**
5. Убедитесь, что все таблицы созданы без ошибок

Проверка:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

Должно быть 14+ таблиц:
- users
- user_statuses
- categories
- products
- product_keys
- orders
- order_items
- promo_codes
- balance_transactions
- referral_settings
- referral_earnings
- banners
- utm_campaigns
- utm_clicks
- mailings
- reviews

## Шаг 3: Настройка Authentication

1. Откройте **Authentication** → **Providers**
2. Включите **Email** провайдер:
   - ✅ Enable Email provider
   - ✅ Confirm email (для продакшена)
   - ✅ Secure email change
   - ✅ Enable email OTP (для magic link)

3. Настройте **Email Templates** (опционально):
   - Customize "Magic Link" template
   - Добавьте брендинг NiceTry

4. В **URL Configuration** добавьте:
   - Site URL: `http://localhost:3000` (для разработки)
   - Redirect URLs: 
     - `http://localhost:3000/auth/callback`
     - `https://your-domain.vercel.app/auth/callback` (для продакшена)

## Шаг 4: Получение ключей

1. Откройте **Settings** → **API**
2. Скопируйте:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ секретный!)

## Шаг 5: Настройка локального окружения

1. Скопируйте `.env.example` в `.env.local`:
```bash
cp .env.example .env.local
```

2. Заполните переменные Supabase:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

3. Остальные переменные (AppRoute, Dessly, Pay4game) заполните позже

## Шаг 6: Проверка подключения

Запустите проект:
```bash
npm install
npm run dev
```

Откройте http://localhost:3000 — должна загрузиться главная страница.

## Шаг 7: Создание первого администратора

После настройки авторизации (Этап 2) выполните в SQL Editor:

```sql
-- Найдите ID вашего пользователя после регистрации
SELECT id, email FROM auth.users;

-- Назначьте права администратора
UPDATE users 
SET is_admin = TRUE 
WHERE email = 'your-email@example.com';
```

## Troubleshooting

### Ошибка "relation does not exist"
- Убедитесь, что схема применена полностью
- Проверьте, что таблицы созданы в схеме `public`

### Ошибка RLS "new row violates row-level security policy"
- Временно отключите RLS для тестирования:
```sql
ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;
```
- После отладки включите обратно

### Ошибка подключения к Supabase
- Проверьте правильность URL и ключей в `.env.local`
- Убедитесь, что файл называется именно `.env.local` (не `.env`)
- Перезапустите dev-сервер после изменения `.env.local`

## Полезные ссылки

- Документация Supabase: https://supabase.com/docs
- Supabase Auth: https://supabase.com/docs/guides/auth
- Row Level Security: https://supabase.com/docs/guides/auth/row-level-security
- SQL Editor: https://supabase.com/docs/guides/database/overview

---

**Следующий шаг:** После успешного развёртывания переходите к Этапу 2 — реализация авторизации на фронтенде.
