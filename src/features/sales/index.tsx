import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function SalesModule() {
  const { t } = useTranslation()
  return (
    <Routes>
      <Route path="/" element={<SalesOverview />} />
      <Route path="*" element={<Navigate to="/sales" replace />} />
    </Routes>
  )
}

function SalesOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  
  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('sales.title')}</h1>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً...
        </p>
      </div>
    </div>
  )
}