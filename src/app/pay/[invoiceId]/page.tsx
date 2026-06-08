import PayClient from '../PayClient'

// Страница ожидания/результата оплаты pay4game. Сюда ведёт чекаут после создания платежа.
export default function PayPage({ params }: { params: { invoiceId: string } }) {
  return <PayClient invoiceId={params.invoiceId} />
}
