/**
 * Work Order Card Component
 * مكون بطاقة أمر العمل
 */

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Timer } from 'lucide-react'
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
  getProgressPercentage,
  isPending
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
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold text-lg">{workOrder.work_order_number}</span>
              {getStatusBadge(workOrder.status)}
              <Badge variant="outline">#{workOrder.operation_sequence}</Badge>
            </div>
            <p className="text-muted-foreground">
              {isRTL ? workOrder.operation_name_ar || workOrder.operation_name : workOrder.operation_name}
            </p>
            
            {/* Progress */}
            <div className="mt-3">
              <div className="flex justify-between text-sm mb-1">
                <span>{isRTL ? 'التقدم' : 'Progress'}</span>
                <span>{workOrder.completed_quantity} / {workOrder.planned_quantity}</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Times */}
            <div className="flex gap-4 mt-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Timer className="w-4 h-4" />
                <span>{isRTL ? 'إعداد:' : 'Setup:'} {workOrder.actual_setup_time || 0}/{workOrder.planned_setup_time} {isRTL ? 'د' : 'min'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{isRTL ? 'تشغيل:' : 'Run:'} {workOrder.actual_run_time || 0}/{workOrder.planned_run_time} {isRTL ? 'د' : 'min'}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {canStartSetup && (
              <Button
                onClick={() => onStartSetup(workOrder)}
                disabled={isPending?.start}
                className="bg-blue-500 hover:bg-blue-600"
              >
                <Play className="w-4 h-4 mr-2" />
                {isRTL ? 'بدء الإعداد' : 'Start Setup'}
              </Button>
            )}
            {canStartProduction && (
              <>
                <Button
                  onClick={() => onStartProduction(workOrder)}
                  disabled={isPending?.start}
                  className="bg-green-500 hover:bg-green-600"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {isRTL ? 'بدء الإنتاج' : 'Start Production'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onPause(workOrder)}
                  disabled={isPending?.pause}
                >
                  <Pause className="w-4 h-4 mr-2" />
                  {isRTL ? 'إيقاف' : 'Pause'}
                </Button>
                <Button
                  onClick={() => onComplete(workOrder)}
                  className="bg-purple-500 hover:bg-purple-600"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {isRTL ? 'تسجيل إنتاج' : 'Report Output'}
                </Button>
              </>
            )}
            {canResume && (
              <Button
                onClick={() => onResume(workOrder)}
                disabled={isPending?.resume}
                className="bg-green-500 hover:bg-green-600"
              >
                <Play className="w-4 h-4 mr-2" />
                {isRTL ? 'استئناف' : 'Resume'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

