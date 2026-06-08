# WORKLOG — Боевая интеграция pay4game

> Короткий журнал. Формат: этап → что сделал → файлы → статус.
> Продолжать СТРОГО с пункта «Продолжить с этапа …» внизу.

## Архитектура (решения)
- **invoice_id** = `supplier_reference_id` заказа (random UUID). По нему вебхук/return/поллинг находят заказ.
- **amount** — единый формат: строка с 2 знаками (`amount.toFixed(2)`), И в подписи, И в параметре запроса.
- **Подпись запроса**: `signPay4game(data)=HMAC_SHA256(SECRET, data).hex`. payment/create: `invoice_id:amount:email`.
- **Live ≠ mock**: в live заказ создаётся в статусе `new` (pending), выдача — ТОЛЬКО из вебхука `status` при `success && hold=0`. Mock-путь не трогаем.
- **Параметры запросов** к API шлём query-string (как в доке curl); при 422 — повтор с JSON-телом.
- Ключи только из `process.env`, fail-fast в live если не заданы.

## Соответствие полей панели pay4game «Настройки»
- «Уведомления» (webhook URL) → `https://www.nicetry.guru/api/pay4game/webhook`
- «Страница результата платежа» (return) → `https://www.nicetry.guru/pay/return/#invoice_id#`

---

## Журнал

- **Этап 0 (аудит)** — DONE.
  - Абстракция: `src/lib/payments/{index,mock,live,token}.ts`. `createPayment(input)` → `PaymentResult{status,paymentId,mode,demo,error}`.
  - Mock-поток: `src/app/api/checkout/guest/route.ts` (создаёт заказ paid синхронно, DEMO-коды), `finalize/route.ts` (ник→аккаунт→авто-вход), `src/app/checkout/page.tsx` (UI: form|nickname|existing).
  - Заказы: таблица `orders` (status CHECK new|paid|delivered|cancelled; payment_method CHECK balance|card|crypto|mock; supplier_reference_id UNIQUE; guest_email). `order_items` (delivery_status pending|delivered|failed, voucher_code).
  - Сессия гостя: `mintSessionForEmail`, checkout-токен `signCheckoutToken(orderId,email)`.
  - Next 14.2.3 App Router, тесты vitest в `tests/integration/`. Supabase admin = `@/lib/supabase/admin`.
  - API pay4game разобран из PDF (7 стр.): payment/create, payment/status, payout/create, steam v2 (check/check_pay/get_status/balance), вебхуки inform/status/status_steam/status_payoff/status_topup.

- **Этап 1 (клиент+подписи)** — DONE.
  - `src/lib/payments/pay4game.ts`: конфиг+fail-fast, formatAmount, signPay4game/signPaymentCreate/signPayoutSbp/signPayoutCard, verifyWebhookSignature(constant-time), post() (query-string + 422→JSON fallback), эндпоинты paymentCreate/paymentStatus/payoutCreateSbp/payoutCreateCard/payoutBanks, steam v2 check/check_pay/get_status/balance.
  - Тест `tests/integration/pay4game-sign.test.ts` — 6/6 PASS (формула подписей + формат суммы + проверка вебхука по сырому телу).

- **Этап 2 (live.ts)** — DONE. `createLivePayment` → paymentCreate → status 'pending' + uuid/url. Расширены `PaymentOrderInput` (clientIp/method/steam*/description) и `PaymentResult` (status 'pending', uuid/url/qrContent/qrImg). Mock не затронут.
- **Этап 3 (webhook + БД)** — DONE.
  - `migrations/2026-06-08_pay4game.sql`: таблицы `payments`, `payment_webhooks` (UNIQUE type+invoice+status), RLS service-only. → ОТДАТЬ Сергею в Supabase SQL Editor.
  - `src/lib/payments/db.ts`: upsertPaymentOnCreate, getPaymentByInvoice, updatePayment, recordWebhook (идемпотентность с учётом processed), markWebhookProcessed.
  - `src/lib/payments/fulfillment.ts`: markOrderPaidAndDeliver — выдача ТОЛЬКО new→paid, идемпотентно, +промокод.
  - `src/app/api/pay4game/webhook/route.ts`: raw body → verify sign (невалид=200/игнор) → лог/идемпотентность → обработка inform/status/status_steam/status_payoff/status_topup. Выдача при status=success && hold=0. Врем. ошибка БД → 500 (ретрай).

- **Этап 4/5 (guest live branch + страница оплаты + выдача)** — DONE.
  - `guest/route.ts`: ветка `paymentsMode()==='live'` — заказ status='new', позиции pending, createPayment(pending), upsertPaymentOnCreate, ответ `{mode:'live', pay_url, invoice_id, uuid, url, token?}`. Mock-ветка не тронута.
  - `checkout/page.tsx`: при `mode==='live'` → `router.push(pay_url)`.
  - `/api/pay4game/status` (GET): статус из БД + fallback-поллинг payment/status → при success&&hold=0 доводит выдачу; отдаёт token ника когда оплачено и заказ гостевой.
  - `src/app/pay/PayClient.tsx` + `/pay/[invoiceId]` + `/pay/return/[invoice_id]`: поллинг, desktop=QR-img, mobile=iframe(qr.content), ссылка оплаты; после оплаты — шаг ника (finalize→авто-вход) либо переход в кабинет/вход по коду.
  - Тест `tests/integration/pay4game-webhook.test.ts` — 7/7 PASS (подпись/идемпотентность/hold/выдача/inform/5xx).
  - Сборка `npm run build` OK; вся сюита `vitest` 362→369 PASS.

- **Этап 6/7 (Steam admin v2 + выплаты)** — DONE.
  - Основной Steam-поток уже покрыт: payment/create со steam_account+steam_amount (PaymentOrderInput/live.ts) → вебхук status_steam.
  - `/api/admin/pay4game/steam` (под админом): GET balance / GET status / POST check. check_pay НЕ выставлен наружу (защита от случайного списания).
  - `/api/admin/pay4game/payout` (под админом + фичефлаг `PAY4GAME_PAYOUTS_ENABLED=1`): GET банки СБП, POST sbp/card. Логирует выплату строкой в payments.

- **Этап 8/9 (проверка + env)** — DONE.
  - `npx tsc --noEmit` чисто, `npm run build` OK, `vitest` 369/369 PASS. Mock/вход по коду/каталог/корзина/поставщики не затронуты.
  - `.env.example`: блок pay4game (token/secret/project/method/sbp_type/return_url/payouts_flag) + адреса вебхука и return.

- **Этап 10 (РЕАЛЬНАЯ выдача в live-вебхуке)** — DONE. (коммит `a356c03`)
  - Снят TODO из «заметок будущего»: live-вебхук больше НЕ выдаёт код-заглушку. `markOrderPaidAndDeliver`
    (`fulfillment.ts`) теперь выдаёт instant-позиции РЕАЛЬНО через общий `deliverInstant`
    (`src/lib/delivery.ts`) — AppRoute (shop) / Dessly (gift) / локальные ключи из `product_keys`.
  - `deliverInstant` вынесен в единый модуль (используется и `/api/orders/create` с баланса, и live-вебхуком).
    topup_*/manual и позиции без `product_id` остаются `pending` (закрывает менеджер). Заказ → `delivered`
    только когда ВСЕ позиции выданы.
  - Устойчивость: сбой/задержка поставщика НЕ бросает исключение (иначе заказ уже `paid`, вебхук вернул бы
    5xx, ретрай увидел бы `paid` и пропустил выдачу) — позиция остаётся `pending`, вебхук отвечает 200.

- **Этап 11 (отложенная Dessly-выдача через form_data)** — DONE. (коммит `4409065`)
  - Проблема: при оплате с баланса выдача синхронна (form_data в запросе), а через pay4game — отложена
    в вебхуке, где form_data взять негде. Из-за этого Dessly-гифты в live не доезжали.
  - Решение — протянул `form_data` (invite-ссылка Steam / регион / издание / package_id) через весь
    live-поток: чекаут → `order_items.form_data` → вебхук → `deliverInstant(…, formData)` → `sendGift`.
  - Миграция `migrations/2026-06-08_order_items_form_data.sql` (`ADD COLUMN IF NOT EXISTS form_data JSONB`,
    идемпотентно). Чекаут устойчив к рассинхрону деплоя/миграции: если колонки ещё нет — повтор вставки без неё.
  - Тест `tests/integration/pay4game-fulfillment.test.ts` — 5/5 PASS (вкл. кейс «form_data доходит до sendGift,
    заказ delivered»). `tsc --noEmit` чисто.

- **Этап 12 (UI-флоу пополнения Steam с карточки главной)** — DONE.
  - Кнопка «Пополнить Steam» (карточка на главной, `src/app/page.tsx`) теперь ведёт на `/steam`
    (была `/catalog?search=Steam`). Форма: РЕГИОН (чипы RU/KZ/UA/BY/Другой) · СУММА (₽, быстрые
    кнопки 500/1000/2000/3000/5000) · логин Steam · email (только для гостя) · живой расчёт комиссии
    и итога → POST `/api/steam/topup` → переход на страницу оплаты `/pay/{invoice}`.
  - Денежная модель: пользователь вводит сумму пополнения в ₽ (зачислится в кошелёк) = `steam_amount`
    (как в доке pay4game, дефолт-лимиты 100–50000 ₽). Комиссия 3% сверху → к оплате
    `charge = round(steamAmount) + round(steamAmount*3%)`; именно `charge` идёт в pay4game как `amount`,
    `steam_amount` — отдельным полем. Регион — метаданные store-региона (в payment/create поля нет),
    пишем в `order_items.form_data` и описание. Лимиты/комиссия — env `STEAM_TOPUP_MIN/MAX/COMMISSION_PERCENT`
    (дефолты 100/50000/3), читаются в `getSteamTopupConfig`.
  - Файлы:
    - `src/lib/steam-topup.ts` — pure (регионы, getSteamTopupConfig, commissionRub, chargeRub,
      normalizeSteamAccount, isValidSteamAccount, validateTopup). Без I/O — тестируемо.
    - `src/app/api/steam/topup/route.ts` — POST. live → order(status=new, payment_method=card,
      1 позиция product_id=null + form_data) → `createPayment({steamAccount,steamAmount,risk:1,...})` →
      `upsertPaymentOnCreate({steam_account,steam_amount})` → `{mode:live, pay_url, invoice_id, uuid, url, token?}`.
      mock → синхронная демо-оплата (order paid, DEMO-код). Поток владельца (session/existing/nickname)
      и токен finalize — как в гостевом чекауте.
    - `src/app/steam/{page,SteamTopupClient}.tsx` — серверная оболочка (config + sessionEmail) + клиентская форма.
  - Переиспользованы (без изменений): `/pay/[invoice]` (QR/поллинг/после-оплатный ник), вебхуки
    `status` (деньги → order paid; позиция без product_id остаётся pending, заказ остаётся `paid` —
    кошелёк пополняет pay4game) и `status_steam` (статус зачисления Steam в payment row).
  - Тесты: `tests/unit/steam-topup.test.ts` — 14/14 PASS. Полная сюита `vitest` — 392/392 PASS.
    `npx tsc --noEmit` чисто. `npm run build` OK (роуты `/steam` и `/api/steam/topup` собрались).
  - НАСТРОЙКА (Сергею): по желанию переопределить `STEAM_TOPUP_MIN/MAX/COMMISSION_PERCENT` в env.
    Боевой запуск — общий с pay4game: `PAYMENTS_MODE=live` + ключи (см. блок ниже). До этого `/steam`
    работает в ДЕМО (mock) — деньги не приняты, Steam не пополнен.

---

## ⚠️ ОТКРЫТО (НЕ доделано в коде)
- **`risk`-флаг по группам товаров.** Параметр `risk` уже есть в `paymentCreate`
  (`pay4game.ts`, тип `0 | 1`), но НЕ проставляется: `createLivePayment` его не передаёт, чекаут не считает.
  Задача владельца: risk=5 для всех групп, risk=1 для TG Stars и пополнений Steam — требует
  (1) расширить шкалу типа до 1..5, (2) решить, как идентифицировать low-risk группы (категория+тип
  товара), (3) посчитать risk на чекауте по составу корзины и прокинуть через `PaymentOrderInput` →
  `live.ts` → `paymentCreate`. НЕ реализовано.

---

## ✅ ГОТОВО. ЧТО СДЕЛАТЬ СЕРГЕЮ (вне кода)

1. **Supabase SQL Editor** — применить миграцию `migrations/2026-06-08_pay4game.sql`
   (таблицы `payments`, `payment_webhooks`). [FIX: функция триггера = `update_updated_at()`,
   миграция создаёт её идемпотентно — ошибки 42883 больше не будет.]
2. **Панель pay4game «Настройки»:**
   - «Уведомления» (webhook) = `https://www.nicetry.guru/api/pay4game/webhook`
   - «Страница результата платежа» = `https://www.nicetry.guru/pay/return/#invoice_id#`
3. **Env (Vercel + .env.local)** — заполнить:
   - `PAY4GAME_API_TOKEN` = <API-токен со страницы «Настройки»>
   - `PAY4GAME_SECRET_KEY` = <секретный ключ>
   - `PAY4GAME_PROJECT_ID` = `58897ce3-4771-401b-893a-8de77ea2421b` (уже в .env.example)
   - (опц.) `PAY4GAME_DEFAULT_METHOD`, `PAY4GAME_SBP_TYPE`, `PAY4GAME_RETURN_URL`, `PAY4GAME_PAYOUTS_ENABLED`
4. **Боевой запуск:** выставить `PAYMENTS_MODE=live` на Vercel (пока стоит `mock` — безопасно).

## ⚠️ ВАЖНЫЕ ЗАМЕТКИ / TODO будущего
- ~~Гостевой live-заказ выдаёт код-заглушку~~ — СНЯТО на Этапе 10/11: выдача реальная через
  `deliverInstant` (AppRoute/Dessly/ключи), Dessly — по `form_data` позиции. См. этапы выше.
- Невалидная подпись вебхука → лог + HTTP 200 (чтобы не ловить вечные ретраи). Если SECRET_KEY
  задан неверно — все вебхуки будут тихо игнорироваться: проверять логи `[pay4game/webhook]`.
- `card`/`sberpay`: ответ `url` открывать в НОВОЙ вкладке (не iframe). Сейчас дефолт — `sbp`+`qr`.
