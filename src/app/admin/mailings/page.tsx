'use client'

export default function AdminMailingsPage() {
  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Рассылки</h1>
        <p className="text-muted">Управление рассылками в Telegram</p>
      </div>

      <div className="card card-pad">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📧</div>
          <h3 className="text-[17px] font-bold text-navy mb-2">
            Раздел в разработке
          </h3>
          <p className="text-muted mb-6">
            Функционал рассылок будет добавлен в следующей версии
          </p>
          <div className="text-sm text-muted-2 max-w-md mx-auto">
            <p className="mb-2">Планируемые возможности:</p>
            <ul className="text-left space-y-1">
              <li>• Создание рассылок для Telegram</li>
              <li>• Сегментация пользователей</li>
              <li>• Шаблоны сообщений</li>
              <li>• Отложенная отправка</li>
              <li>• Статистика доставки и открытий</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
