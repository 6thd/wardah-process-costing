/**
 * Work Orders Empty State Component
 * مكون حالة فارغة لأوامر العمل
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Factory } from 'lucide-react'

export const WorkOrdersEmptyState: React.FC = () => {
  const { t } = useTranslation()
  return (
    <div className="text-center py-12">
      <Factory className="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 className="mt-2 text-lg font-medium">{t('wcDashboard.empty.title')}</h3>
      <p className="mt-1 text-muted-foreground">
        {t('wcDashboard.empty.subtitle')}
      </p>
    </div>
  )
}

