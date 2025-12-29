/**
 * Work Order Card Component
 * مكون بطاقة أمر العمل
 */

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Play,
  Pause,
  CheckCircle,
  Clock,
  Package,
  Timer,
} from 'lucide-react'
import type { WorkOrder } from '@/services/manufacturing/mesService'

interface WorkOrderCardProps {
  workOrder: WorkOrder
  isRTL: boolean
  onStartSetup: (workOrder: WorkOrder) => void
  onStartProduction: (workOrder: WorkOrder) => void
  onPause: (workOrder: WorkOrder) => void
  onResume: (workOrder: WorkOrder) => void
  onComplete: (workOrder: WorkOrder) => void
  getStatusBadge: (status: string) => React.ReactNode
  getProgressPercentage: (workOrder: WorkOrder) => number
}

export const WorkOrderCard: React.FC<WorkOrderCardProps> = ({
  workOrder,
  isRTL,
  onStartSetup,
  onStartProduction,
  onPause,
  onResume,
  onComplete,
  getStatusBadge,
  getProgressPercentage
}) => {
  const progress = getProgressPercentage(workOrder)
  const canStartSetup = workOrder.status === 'READY' || workOrder.status === 'PENDING'
  const canStartProduction = workOrder.status === 'IN_SETUP'
  const canPause = workOrder.status === 'IN_PROGRESS'
  const canResume = workOrder.status === 'ON_HOLD'

  return (
    <Card key={workOrder.id} className="border-2">
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Work Order Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-semibold text-lg">{workOrder.work_order_number}</h3>
              {getStatusBadge(workOrder.status)}
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{isRTL ? 'الكمية المخططة:' : 'Planned Qty:'}</span>
                <span className="ml-2 font-medium">{workOrder.planned_quantity}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{isRTL ? 'المكتملة:' : 'Completed:'}</span>
                <span className="ml-2 font-medium">{workOrder.completed_quantity}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{isRTL ? 'الخردة:' : 'Scrapped:'}</span>
                <span className="ml-2 font-medium text-red-600">{workOrder.scrapped_quantity}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{isRTL ? 'المتبقي:' : 'Remaining:'}</span>
                <span className="ml-2 font-medium">
                  {workOrder.planned_quantity - workOrder.completed_quantity - workOrder.scrapped_quantity}
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1">
                <span>{isRTL ? 'التقدم' : 'Progress'}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {canStartSetup && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onStartSetup(workOrder)}
              >
                <Clock className="w-4 h-4 mr-2" />
                {isRTL ? 'بدء الإعداد' : 'Start Setup'}
              </Button>
            )}
            {canStartProduction && (
              <Button
                size="sm"
                onClick={() => onStartProduction(workOrder)}
              >
                <Play className="w-4 h-4 mr-2" />
                {isRTL ? 'بدء الإنتاج' : 'Start Production'}
              </Button>
            )}
            {canPause && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onPause(workOrder)}
              >
                <Pause className="w-4 h-4 mr-2" />
                {isRTL ? 'إيقاف' : 'Pause'}
              </Button>
            )}
            {canResume && (
              <Button
                size="sm"
                onClick={() => onResume(workOrder)}
              >
                <Play className="w-4 h-4 mr-2" />
                {isRTL ? 'استئناف' : 'Resume'}
              </Button>
            )}
            <Button
              size="sm"
              variant="default"
              onClick={() => onComplete(workOrder)}
              disabled={workOrder.status === 'COMPLETED'}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {isRTL ? 'إكمال' : 'Complete'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

