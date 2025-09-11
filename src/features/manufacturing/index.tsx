import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import StageCostingPanel from './stage-costing-panel.tsx'

export function ManufacturingModule() {
  const { t } = useTranslation()

  return (
    <Routes>
      <Route path="/" element={<ManufacturingOverview />} />
      <Route path="/overview" element={<ManufacturingOverview />} />
      <Route path="/process-costing" element={<ProcessCostingPage />} />
      <Route path="*" element={<Navigate to="/manufacturing/overview" replace />} />
    </Routes>
  )
}

function ProcessCostingPage() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">تكاليف المراحل (Process Costing)</h1>
        <p className="text-muted-foreground mt-2">
          نظام متقدم لاحتساب تكاليف مراحل التصنيع
        </p>
      </div>

      <StageCostingPanel />
    </div>
  )
}

function ManufacturingOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('manufacturing.title')}</h1>
        <p className="text-muted-foreground mt-2">
          إدارة عمليات التصنيع وتكاليف المراحل
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-card rounded-lg border p-6">
          <h3 className={cn(
            "font-semibold mb-2",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('manufacturing.overview')}
          </h3>
          <p className={cn(
            "text-muted-foreground text-sm",
            isRTL ? "text-right" : "text-left"
          )}>
            عرض عام لعمليات التصنيع النشطة
          </p>
        </div>

        <Link to="/manufacturing/process-costing" className="bg-card rounded-lg border p-6 hover:bg-accent transition-colors">
          <h3 className={cn(
            "font-semibold mb-2",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('manufacturing.processCosting')}
          </h3>
          <p className={cn(
            "text-muted-foreground text-sm",
            isRTL ? "text-right" : "text-left"
          )}>
            نظام تكاليف المراحل المتقدم
          </p>
        </Link>

        <div className="bg-card rounded-lg border p-6">
          <h3 className={cn(
            "font-semibold mb-2",
            isRTL ? "text-right" : "text-left"
          )}>
            {t('manufacturing.workCenters')}
          </h3>
          <p className={cn(
            "text-muted-foreground text-sm",
            isRTL ? "text-right" : "text-left"
          )}>
            إدارة مراكز العمل والموارد
          </p>
        </div>
      </div>
    </div>
  )
}