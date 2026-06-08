import PayClient from '../../PayClient'

// Return URL из панели pay4game «Настройки»:
//   https://www.nicetry.guru/pay/return/#invoice_id#
// Макрос #invoice_id# pay4game подставит номером заказа (= наш invoice_id). Рендерим тот же
// клиент ожидания/результата, что и /pay/[invoiceId] — он опросит статус и доведёт поток.
export default function PayReturnPage({ params }: { params: { invoice_id: string } }) {
  return <PayClient invoiceId={params.invoice_id} />
}
