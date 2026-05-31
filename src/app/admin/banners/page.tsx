'use client'

export default function AdminBannersPage() {
  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-navy mb-2">Баннеры</h1>
        <p className="text-muted">Управление баннерами на главной странице</p>
      </div>

      <div className="card card-pad">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🖼️</div>
          <h3 className="text-[17px] font-bold text-navy mb-2">
            Раздел в разработке
          </h3>
          <p className="text-muted mb-6">
            Функционал управления баннерами будет добавлен в следующей версии
          </p>
          <div className="text-sm text-muted-2 max-w-md mx-auto">
            <p className="mb-2">Планируемые возможности:</p>
            <ul className="text-left space-y-1">
              <li>• Загрузка изображений баннеров</li>
              <li>• Настройка ссылок и позиций</li>
              <li>• Управление порядком отображения</li>
              <li>• Планирование показа по датам</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
