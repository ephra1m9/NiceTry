-- pay4game: сохранять ссылку на хостовую страницу оплаты (ответ payment/create → url).
-- Нужна странице /pay как кнопка «Перейти к оплате» (для card/sberpay и как фолбэк, когда
-- QR-вебхук inform ещё не пришёл/не приходит — например, при пополнении Steam).
-- Идемпотентно: безопасно применять повторно.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS url TEXT;
