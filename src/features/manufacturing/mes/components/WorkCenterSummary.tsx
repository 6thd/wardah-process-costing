/**
 * Work Center Summary Component
 * مكون ملخص مركز العمل
 */

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Clock, Activity, CheckCircle, Package, TrendingUp } from 'lucide-react'

interface WorkCenterSummaryProps {
  summary: {
    pending?: number
    in_progress?: number
    completed_today?: number
    total_produced_today?: number
    efficiency?: number
  } | undefined
  isRTL: boolean
}

export const WorkCenterSummary: React.FC<WorkCenterSummaryProps> = ({ summary, isRTL }) => {
  return (
    <div className="grid gap-4 md:grid-cols-5">
      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{isRTL ? 'في الانتظار' : 'Pending'}</p>
              <p className="text-2xl font-bold">{summary?.pending || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-green-100 rounded-lg dark:bg-green-900">
              <Activity className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{isRTL ? 'قيد التنفيذ' : 'In Progress'}</p>
              <p className="text-2xl font-bold">{summary?.in_progress || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-purple-100 rounded-lg dark:bg-purple-900">
              <CheckCircle className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{isRTL ? 'مكتمل اليوم' : 'Completed Today'}</p>
              <p className="text-2xl font-bold">{summary?.completed_today || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-yellow-100 rounded-lg dark:bg-yellow-900">
              <Package className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{isRTL ? 'الإنتاج اليوم' : 'Produced Today'}</p>
              <p className="text-2xl font-bold">{summary?.total_produced_today || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="wardah-glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-cyan-100 rounded-lg dark:bg-cyan-900">
              <TrendingUp className="w-6 h-6 text-cyan-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{isRTL ? 'الكفاءة' : 'Efficiency'}</p>
              <p className="text-2xl font-bold">{summary?.efficiency || 100}%</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

