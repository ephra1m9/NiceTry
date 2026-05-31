'use client'

export default function AdminUTMPage() {
  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">UTM-кампании</h1>
        <p className="text-muted">Отслеживание источников трафика и конверсий</p>
      </div>

      <div className="card card-pad">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📈</div>
          <h3 className="text-[17px] font-bold text-navy mb-2">
            Раздел в разработке
          </h3>
          <p className="text-muted mb-6">
            Функционал UTM-аналитики будет добавлен в следующей версии
          </p>
          <div className="text-sm text-muted-2 max-w-md mx-auto">
            <p className="mb-2">Планируемые возможности:</p>
            <ul className="text-left space-y-1">
              <li>• Создание UTM-меток для кампаний</li>
              <li>• Генерация ссылок с параметрами</li>
              <li>• Статистика по источникам трафика</li>
              <li>• Отчёты по конверсиям и выручке</li>
              <li>• Интеграция с Google Analytics</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
