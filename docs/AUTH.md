# Авторизация в NiceTry

## Обзор

Проект использует Supabase Auth с Magic Link (вход по email без пароля).

## Архитектура

### Supabase клиенты

- **Browser Client** (`src/lib/supabase/client.ts`) — для Client Components
- **Server Client** (`src/lib/supabase/server.ts`) — для Server Components и API Routes
- **Middleware Client** (`src/lib/supabase/middleware.ts`) — для middleware
- **Admin Client** (`src/lib/supabase/admin.ts`) — для операций с service role

### Хуки

#### useAuth()

Предоставляет информацию об авторизации из Supabase Auth:

```tsx
import { useAuth } from '@/hooks/useAuth'

function MyComponent() {
  const { user, loading, signOut } = useAuth()
  
  if (loading) return <div>Загрузка...</div>
  if (!user) return <div>Не авторизован</div>
  
  return (
    <div>
      <p>Email: {user.email}</p>
      <button onClick={signOut}>Выйти</button>
    </div>
  )
}
```

#### useUser()

Предоставляет профиль пользователя из таблицы `users`:

```tsx
import { useUser } from '@/hooks/useUser'

function ProfileComponent() {
  const { user, loading, error, refetch, updateUser } = useUser()
  
  if (loading) return <div>Загрузка...</div>
  if (error) return <div>Ошибка: {error}</div>
  if (!user) return <div>Профиль не найден</div>
  
  return (
    <div>
      <p>Баланс: {user.balance} ₽</p>
      <p>Статус: {user.status.name}</p>
      <p>Реферальный код: {user.referral_code}</p>
    </div>
  )
}
```

## API Routes

### POST /api/auth/login

Отправляет magic link на email.

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response (success):**
```json
{
  "message": "Проверьте почту — мы отправили ссылку для входа"
}
```

**Response (error):**
```json
{
  "error": "Некорректный email"
}
```

### POST /api/auth/logout

Выход из системы.

**Response:**
```json
{
  "success": true
}
```

### GET /api/user/profile

Получить профиль текущего пользователя.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "balance": 0,
  "status": {
    "name": "Bronze",
    "discount_percent": 0
  },
  "referral_code": "ABC12345",
  "created_at": "2026-05-31T10:00:00Z"
}
```

### PATCH /api/user/profile

Обновить профиль.

**Request:**
```json
{
  "telegram_id": "123456789"
}
```

**Response:** обновлённый профиль (как в GET)

## Middleware

Middleware автоматически защищает роуты:

- `/profile`, `/orders`, `/balance` — требуют авторизации
- `/admin/*` — требуют авторизации + роль admin

При попытке доступа неавторизованного пользователя происходит редирект на `/auth/login?redirect=/original-path`.

## Использование в Server Components

```tsx
import { createClient } from '@/lib/supabase/server'

export default async function ServerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }
  
  return <div>Привет, {user.email}</div>
}
```

## Использование в Client Components

```tsx
'use client'

import { useAuth } from '@/hooks/useAuth'

export default function ClientPage() {
  const { user, loading } = useAuth()
  
  if (loading) return <div>Загрузка...</div>
  if (!user) return <div>Не авторизован</div>
  
  return <div>Привет, {user.email}</div>
}
```

## Создание профиля

При первом входе пользователя автоматически создаётся запись в таблице `users`:

- `id` — UUID из Supabase Auth
- `email` — из Supabase Auth
- `balance` — 0
- `status_id` — Bronze (по умолчанию)
- `referral_code` — случайный 8-символьный код (A-Z0-9)

## Тестирование локально

1. Запустите проект: `npm run dev`
2. Откройте http://localhost:3000/auth/login
3. Введите email
4. Проверьте Supabase Dashboard → Authentication → Users → Email Templates
5. Скопируйте ссылку из письма (или используйте Inbucket если настроен)
6. Перейдите по ссылке — вы будете авторизованы

## Переменные окружения

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```
