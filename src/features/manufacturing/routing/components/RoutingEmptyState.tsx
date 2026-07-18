/**
 * Routing Empty State Component
 * مكون حالة فارغة للمسارات
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Route, Plus } from 'lucide-react'
// Removed unused import: useNavigate

interface RoutingEmptyStateProps {
  onCreateNew: () => void
}

export const RoutingEmptyState: React.FC<RoutingEmptyStateProps> = ({
  onCreateNew
}) => {
  const { t } = useTranslation()
  return (
    <div className="text-center py-12">
      <Route className="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 className="mt-2 text-lg font-medium">{t('routingMgmt.empty.title')}</h3>
      <p className="mt-1 text-muted-foreground">
        {t('routingMgmt.empty.subtitle')}
      </p>
      <Button className="mt-4" onClick={onCreateNew}>
        <Plus className="w-4 h-4 mr-2" />
        {t('routingMgmt.empty.cta')}
      </Button>
    </div>
  )
}

