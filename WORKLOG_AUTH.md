# WORKLOG — Новая авторизация (Resend email-код + ник + гостевой чекаут)

Формат строки: `дата — этап X.Y — что сделал — файлы — статус`

---

## Этап 0 — Аудит текущей авторизации

**2026-06-05 — этап 0 — аудит завершён — (read-only) — OK / НУЖНЫ РЕШЕНИЯ ОТ ПОЛЬЗОВАТЕЛЯ**

Что нашёл в реальном коде (проект `C:\Users\user\Desktop\NiceTry`, Next.js 14 + Supabase):

### Авторизация сейчас
- Используется **Supabase Auth (magic link / OTP по email)**. Письмо шлёт сам Supabase (встроенный SMTP).
  - Отправка письма: `src/app/api/auth/login/route.ts` → `supabase.auth.signInWithOtp({ email })`.
  - Подтверждение ссылки: `src/app/api/auth/callback/route.ts` → `exchangeCodeForSession`.
  - Dev-вход без письма: `src/app/api/auth/dev-login/route.ts` → `admin.generateLink` + `verifyOtp` (создаёт сессию). ← важный шаблон, как минтить сессию без письма.
- **Сессия = Supabase SSR cookies** (httpOnly), управляется `@supabase/ssr`. Своего JWT/секрета НЕТ. `AUTH_SESSION_SECRET` в проекте не используется.
- `users.id` == Supabase auth user id. Весь код опирается на `supabase.auth.getUser()` → `authUser.id` (профиль, заказы, баланс, middleware, admin).
- Middleware (`src/middleware.ts`) защищает `/profile`, `/orders`, `/balance`, `/admin`.

### Где Supabase шлёт письма
- Только magic link OTP из `/api/auth/login` (`signInWithOtp`). Других триггеров (signUp-confirm, resetPassword) в коде нет.

### Чекаут / заказы
- Файл чекаута: `src/app/checkout/page.tsx`. Создание заказа: `src/app/api/orders/create/route.ts`.
- **Чекаут СЕЙЧАС требует авторизацию**: order create отдаёт `401` без сессии. Email на чекауте НЕ собирается (берётся из сессии).
- **Кода-подтверждения почты ПРИ ОПЛАТЕ НЕТ** — то есть убирать на чекауте нечего (этого шага не существует).
- **Оплата только с внутреннего баланса.** Карта/крипта → `501` (не реализовано). Платёжный шлюз (Pay4game в .env) НЕ подключён — реального «callback от платёжки» в коде нет.
- Заказ привязан к пользователю через `orders.user_id` (FK на `users.id`).

### Users / ник
- Поля `nickname`/`username` НЕТ. Пользователь идентифицируется email + referral_code.
- Профиль создаётся лениво при первом GET `/api/user/profile` (Bronze, реф-код).

### Инфраструктура
- Rate-limiter уже есть: `src/lib/rate-limit.ts` — `rateLimit(key, limit, windowMs)`, `clientIp(headers)`. In-memory (на serverless не делится между инстансами, но как барьер от флуда годится).
- HMAC-утилиты есть в `src/lib/telegram/verify.ts` (пример подписи токенов через `createHmac`).
- Схема БД: `supabase_schema.sql`. Миграции в `migrations/*.sql`.

### ⚠️ ГЛАВНЫЙ КОНФЛИКТ (см. вопросы пользователю)
ТЗ написано под архитектуру (кастомные JWT-сессии, гостевой чекаут, callback от платёжки),
которой в проекте НЕТ: тут Supabase Auth + оплата только с баланса + чекаут под логином.
Нельзя «просто сделать как в ТЗ», не сломав работающий магазин. Остановился, задаю вопросы.

**Жду ответов пользователя по: (1) механизм сессии, (2) гостевой чекаут vs оплата.**

### Решения пользователя (2026-06-05)
1. **Сессия:** оставляем Supabase-сессии. Свой код-вход через Resend → после верификации кода
   сервер минтит обычную Supabase-сессию приёмом `admin.generateLink` + `verifyOtp`
   (как уже делает dev-login). Ничего из работающего не ломаем; Supabase письма больше не шлёт.
2. **Чекаут/оплата:** auth-first. Делаем код-вход + ник. Чекаут и оплату НЕ трогаем
   (гостевую покупку и экран «ник после оплаты» подключим, когда будет платёжный шлюз).

### План реализации (под решения)
- Этап 1: миграция `migrations/auth_resend.sql` — таблица `auth_codes` + колонка `users.nickname`.
- Этап 2: `src/lib/resend.ts` — отправка кода письмом (boevoy, ключ из env, dev-фолбэк в консоль).
- Этап 3: `src/lib/auth/codes.ts` (ген/хеш/проверка) + роуты
  `POST /api/auth/send-code`, `POST /api/auth/verify-code` (только ВХОД).
- Этап 4 (урезан): ник — `GET /api/user/nickname/check`, `POST /api/user/nickname`
  + экран выбора ника в профиле. Чекаут не трогаем.
- Этап 5: фронт логина — два шага (ввод ника/почты → ввод кода). Старый magic-link/Supabase-письмо убираем.
- Этап 6: build/lint/тесты + инструкции пользователю (Resend ключ, DNS, SQL, Supabase off).

---

## Этап 1 — Миграция БД

**2026-06-05 — этап 1.1 — миграция готова — `migrations/auth_resend.sql` — НАДО ДЕЙСТВИЕ ОТ ПОЛЬЗОВАТЕЛЯ**
- Создал `auth_codes` (email, code_hash, expires_at, attempts, consumed_at, created_at) + индексы + RLS (только service-role).
- Добавил `users.nickname` (nullable) + частичный UNIQUE-индекс `LOWER(nickname)` (регистронезависимо, NULL не блокирует).
- Идемпотентна (`IF NOT EXISTS`), есть `NOTIFY pgrst`.
- ⚠️ К боевой базе сам НЕ применял. Пользователю: выполнить в Supabase SQL Editor (инструкция в конце WORKLOG).

---

## Этап 2 — Resend

**2026-06-05 — этап 2.1 — модуль отправки готов — `src/lib/resend.ts`, `.env.example` — OK / НАДО КЛЮЧ+DNS ОТ ПОЛЬЗОВАТЕЛЯ**
- `sendAuthCode(email, code, idempotencyId)` → `POST https://api.resend.com/emails`, `Bearer` ключ из env, явный `User-Agent`, `Idempotency-Key: auth-code/<email>/<id>`.
- Брендовый светлый HTML-шаблон + text-версия, тема «Ваш код для входа в NiceTry», TTL из `AUTH_CODE_TTL_MINUTES`.
- Ошибки: `429`→`rate_limit`, `401/403/422`→`invalid_config` (лог для админа, юзеру «позже»), `5xx`/сеть→`server`. Класс `ResendSendError{kind,status}`.
- Без ключа: dev — печать кода в консоль (`{ok,dev:true}`), prod — throw.
- Без SDK (как остальные интеграции проекта на fetch). Пакет `resend` НЕ ставил — не нужен.
- `.env.example`: добавил блок RESEND (`RESEND_API_KEY`, `RESEND_FROM`, `AUTH_CODE_TTL_MINUTES`, `AUTH_SESSION_SECRET`).

---

## Этап 3 — API кода (только ВХОД)

**2026-06-05 — этап 3.1 — утилита кодов — `src/lib/auth/codes.ts` — OK**
- `generateCode()` (crypto.randomInt, 6 цифр), `hashCode(email,code)` = HMAC-SHA256(`AUTH_SESSION_SECRET`, `email:code`), `verifyCodeHash` (timingSafeEqual), `normalizeEmail`, `isValidEmail`, `MAX_CODE_ATTEMPTS=5`, `codeTtlMinutes()`. Код в БД не хранится — только хеш.

**2026-06-05 — этап 3.2 — POST /api/auth/send-code — `src/app/api/auth/send-code/route.ts` — OK**
- identifier = email → шлём код; identifier = ник → резолвим email по `ilike(nickname)`, не найден → generic-OK без письма (не палим существование).
- Rate-limit: cooldown 60с/почта, 6/час/почта, 30/час/IP → `429 + Retry-After`. Ошибки Resend разобраны, при сбое чистим созданный код.

**2026-06-05 — этап 3.3 — POST /api/auth/verify-code — `src/app/api/auth/verify-code/route.ts` — OK**
- Берём свежий неиспользованный код по почте: проверка expires/consumed/attempts/хеш. Неверно → attempts++ (после 5 — блок). Верно → consumed_at (CAS против гонки) → минтим Supabase-сессию (createUser+generateLink+verifyOtp, как dev-login).
- Возвращает `{ success, needsNickname }`. Не раскрывает существование аккаунта.

**⚠️ ПРОВЕРКА BUILD:** окружение блокирует запуск команд (`tsc`/`npm` денятся авто-режимом). Сборку/линт/тесты нужно будет запустить с разрешения пользователя на Этапе 6.

---

## Этап 4 — Ник (бэкенд)

**2026-06-05 — этап 4.1 — валидация + роуты ника — `src/lib/auth/nickname.ts`, `src/app/api/user/nickname/route.ts`, `src/app/api/user/nickname/check/route.ts` — OK**
- `validateNickname` (латиница/цифры/`_`/`-`, 3–20). `GET /api/user/nickname/check?nickname=` — live «свободен/занят» (публичный, регистронезависимо). `POST /api/user/nickname` — установка ника текущему юзеру (по сессии), создаёт профиль если его нет, ловит гонку по 23505, повторно ник не меняет (409).
- Чекаут не трогали (решение: auth-first, гостевой чекаут позже с платёжным шлюзом).

---

## Этап 5 — Фронт логина + ник в профиле

**2026-06-05 — этап 5.1 — новая страница входа (3 шага) — `src/app/auth/login/page.tsx` — OK**
- Шаг 1: ввод ник/почта → `POST /api/auth/send-code`. Шаг 2: код (6 цифр, only-digits, resend с кулдауном 60с, «изменить ник/почту») → `POST /api/auth/verify-code` → если `needsNickname` → шаг 3, иначе на `/`. Шаг 3: «придумайте ник» с live-проверкой (debounce 400мс) → `POST /api/user/nickname` → `/profile`.
- Старый magic-link UI убран. Dev-кнопка «войти без письма» только при `NODE_ENV!=='production'`. Поддержка `?step=nickname` (залогиненный без ника из профиля).

**2026-06-05 — этап 5.2 — старый magic-link роут деактивирован — `src/app/api/auth/login/route.ts` — OK**
- Заменил тело на заглушку `410 Gone` (раньше дёргал `signInWithOtp` → письмо Supabase). Теперь Supabase письма не шлёт даже при случайном вызове.

**2026-06-05 — этап 5.3 — ник в профиле — `src/app/profile/page.tsx` — OK**
- Заголовок профиля = ник (email подзаголовком). В «Основная информация» строка «Никнейм»; если ника нет — ссылка «Выбрать ник» → `/auth/login?step=nickname`.

---

## Этап 6 — Сборка и финал

**2026-06-06 — этап 6.1 — type-check — OK**
- `npx tsc --noEmit` — без ошибок (весь TS компилируется, включая новые роуты и фронт).
- ESLint в проекте не настроен (`next lint` просит интерактивную инициализацию) — пропущено.
- `npm run build` — УСПЕШНО (2026-06-06). Все новые роуты собрались: `/auth/login`, `/api/auth/send-code`, `/api/auth/verify-code`, `/api/user/nickname`, `/api/user/nickname/check`. Ошибок нет.

**2026-06-06 — этап 6.2 — НУЖНЫ ДЕЙСТВИЯ ОТ ПОЛЬЗОВАТЕЛЯ (см. чат):**
1. SQL: выполнить `migrations/auth_resend.sql` в Supabase SQL Editor.
2. Resend: вписать реальный `RESEND_API_KEY` + `AUTH_SESSION_SECRET` в `.env.local` и в Vercel (Production).
3. Resend: подтвердить домен `nicetry.guru` (DNS-записи) для отправки от `noreply@nicetry.guru`.
4. Supabase: отключить отправку email (Auth → Email) — Supabase письма больше не нужны (код шлёт Resend).
5. `npm run build` локально, затем Redeploy на Vercel.

