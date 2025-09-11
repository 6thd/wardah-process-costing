import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function InventoryModule() {

  return (
    <Routes>
      <Route path="/" element={<InventoryOverview />} />
      <Route path="/items" element={<InventoryOverview />} />
      <Route path="*" element={<Navigate to="/inventory/items" replace />} />
    </Routes>
  )
}

function InventoryOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('inventory.title')}</h1>
        <p className="text-muted-foreground mt-2">
          إدارة المخزون والأصناف
        </p>
      </div>

      <div className="bg-card rounded-lg border p-6">
        <h3 className={cn(
          "font-semibold mb-2",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً...
        </h3>
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          سيتم إضافة وحدة إدارة المخزون قريباً
        </p>
      </div>
    </div>
  )
}