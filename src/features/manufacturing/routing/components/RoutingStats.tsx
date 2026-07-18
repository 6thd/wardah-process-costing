/**
 * Routing Stats Component
 * مكون إحصائيات المسارات
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { Route, CheckCircle, Edit, Settings } from 'lucide-react'
import type { Routing } from '@/services/manufacturing/routingService'

interface RoutingStatsProps {
  routings: Routing[] | undefined
}

export const RoutingStats: React.FC<RoutingStatsProps> = ({ routings }) => {
  const { t } = useTranslation()
  const totalRoutings = routings?.length || 0
  const approvedCount = routings?.filter((r: Routing) => r.status === 'APPROVED').length || 0
  const draftCount = routings?.filter((r: Routing) => r.status === 'DRAFT').length || 0
  const activeCount = routings?.filter((r: Routing) => r.is_active).length || 0

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
              <Route className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('routingMgmt.stats.total')}</p>
              <p className="text-2xl font-bold">{totalRoutings}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-green-100 rounded-lg dark:bg-green-900">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('routingMgmt.stats.approved')}</p>
              <p className="text-2xl font-bold">{approvedCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-yellow-100 rounded-lg dark:bg-yellow-900">
              <Edit className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('routingMgmt.stats.drafts')}</p>
              <p className="text-2xl font-bold">{draftCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-purple-100 rounded-lg dark:bg-purple-900">
              <Settings className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('routingMgmt.stats.active')}</p>
              <p className="text-2xl font-bold">{activeCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

