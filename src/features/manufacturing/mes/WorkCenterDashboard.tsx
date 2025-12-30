/**
 * Work Center Dashboard - لوحة تحكم مركز العمل (MES)
 * واجهة مشغل مركز العمل
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Wrench,
  Factory
} from 'lucide-react'
import { useWorkOrders, useStartOperation, useCompleteOperation, usePauseWorkOrder, useResumeWorkOrder, useWorkCenterSummary } from '@/hooks/manufacturing/useMES'
import { WorkOrder } from '@/services/manufacturing/mesService'
import { useQuery } from '@tanstack/react-query'
import { supabase, getEffectiveTenantId } from '@/lib/supabase'
import { WorkOrderCard } from './components/WorkOrderCard'
import { WorkCenterSummary } from './components/WorkCenterSummary'
import { WorkOrdersEmptyState } from './components/WorkOrdersEmptyState'

export function WorkCenterDashboard() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('')
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null)
  const [quantityProduced, setQuantityProduced] = useState<number>(0)
  const [quantityScrapped, setQuantityScrapped] = useState<number>(0)
  const [notes, setNotes] = useState('')

  // Fetch work centers
  const { data: workCenters } = useQuery({
    queryKey: ['work-centers'],
    queryFn: async () => {
      const orgId = await getEffectiveTenantId()
      const { data, error } = await supabase
        .from('work_centers')
        .select('id, name, name_ar, is_active')
        .eq('org_id', orgId)
        .eq('is_active', true)
      if (error) throw error
      return data
    }
  })

  // Set default work center
  useEffect(() => {
    if (workCenters?.length && !selectedWorkCenter) {
      setSelectedWorkCenter(workCenters[0].id)
    }
  }, [workCenters, selectedWorkCenter])

  // Fetch work orders for selected work center
  const { data: workOrders, isLoading, refetch } = useWorkOrders({
    workCenterId: selectedWorkCenter,
    status: ['PENDING', 'READY', 'IN_SETUP', 'IN_PROGRESS', 'ON_HOLD']
  })

  // Work center summary
  const { data: summary } = useWorkCenterSummary(selectedWorkCenter)

  // Mutations
  const startOperation = useStartOperation()
  const completeOperation = useCompleteOperation()
  const pauseWorkOrder = usePauseWorkOrder()
  const resumeWorkOrder = useResumeWorkOrder()

  const handleStartSetup = (workOrder: WorkOrder) => {
    startOperation.mutate({
      workOrderId: workOrder.id,
      isSetup: true
    })
  }

  const handleStartProduction = (workOrder: WorkOrder) => {
    startOperation.mutate({
      workOrderId: workOrder.id,
      isSetup: false
    })
  }

  const handlePause = (workOrder: WorkOrder) => {
    pauseWorkOrder.mutate({ workOrderId: workOrder.id })
  }

  const handleResume = (workOrder: WorkOrder) => {
    resumeWorkOrder.mutate({ workOrderId: workOrder.id })
  }

  const openCompleteDialog = (workOrder: WorkOrder) => {
    setSelectedWorkOrder(workOrder)
    setQuantityProduced(workOrder.planned_quantity - workOrder.completed_quantity - workOrder.scrapped_quantity)
    setQuantityScrapped(0)
    setNotes('')
    setShowCompleteDialog(true)
  }

  const handleComplete = () => {
    if (selectedWorkOrder) {
      completeOperation.mutate({
        workOrderId: selectedWorkOrder.id,
        quantityProduced,
        quantityScrapped,
        notes
      }, {
        onSuccess: () => {
          setShowCompleteDialog(false)
          setSelectedWorkOrder(null)
        }
      })
    }
  }

  // Helper function to reduce cognitive complexity
  const getStatusConfig = (status: string) => {
    const statusMap: Record<string, { variant?: string; className?: string; label: { ar: string; en: string } }> = {
      'PENDING': { variant: 'secondary', label: { ar: 'في الانتظار', en: 'Pending' } },
      'READY': { className: 'bg-blue-500', label: { ar: 'جاهز', en: 'Ready' } },
      'IN_SETUP': { className: 'bg-yellow-500', label: { ar: 'إعداد', en: 'Setup' } },
      'IN_PROGRESS': { className: 'bg-green-500', label: { ar: 'قيد التنفيذ', en: 'In Progress' } },
      'ON_HOLD': { className: 'bg-orange-500', label: { ar: 'معلق', en: 'On Hold' } },
      'COMPLETED': { className: 'bg-purple-500', label: { ar: 'مكتمل', en: 'Completed' } }
    }
    return statusMap[status] || { label: { ar: status, en: status } }
  }

  const getStatusBadge = (status: string) => {
    const config = getStatusConfig(status)
    const label = isRTL ? config.label.ar : config.label.en
    
    if (config.variant) {
      return <Badge variant={config.variant as any}>{label}</Badge>
    }
    if (config.className) {
      return <Badge className={config.className}>{label}</Badge>
    }
    return <Badge>{label}</Badge>
  }

  const getProgressPercentage = (workOrder: WorkOrder) => {
    const total = workOrder.planned_quantity
    const completed = workOrder.completed_quantity + workOrder.scrapped_quantity
    return Math.round((completed / total) * 100)
  }

  const currentWorkCenter = workCenters?.find(wc => wc.id === selectedWorkCenter)

  return (
    <div className={`space-y-6 p-6 ${isRTL ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold wardah-text-gradient-google">
            <Factory className="inline-block w-8 h-8 mr-2" />
            {isRTL ? 'لوحة تحكم مركز العمل' : 'Work Center Dashboard'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isRTL ? 'نظام تنفيذ التصنيع (MES)' : 'Manufacturing Execution System (MES)'}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={selectedWorkCenter} onValueChange={setSelectedWorkCenter}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={isRTL ? 'اختر مركز العمل' : 'Select Work Center'} />
            </SelectTrigger>
            <SelectContent>
              {workCenters?.map(wc => (
                <SelectItem key={wc.id} value={wc.id}>
                  {isRTL ? (wc.name_ar || wc.name) : wc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <WorkCenterSummary summary={summary} isRTL={isRTL} />

      {/* Active Work Orders */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            {isRTL ? 'أوامر العمل النشطة' : 'Active Work Orders'}
          </CardTitle>
          <CardDescription>
            {isRTL 
              ? `مركز العمل: ${currentWorkCenter?.name_ar || currentWorkCenter?.name || '-'}`
              : `Work Center: ${currentWorkCenter?.name || '-'}`
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin" />
            </div>
          ) : (!workOrders || workOrders.length === 0) ? (
            <WorkOrdersEmptyState isRTL={isRTL} />
          ) : (
            <div className="space-y-4">
              {(workOrders || []).map((wo: WorkOrder) => (
                <WorkOrderCard
                  key={wo.id}
                  workOrder={wo}
                  isRTL={isRTL}
                  onStartSetup={handleStartSetup}
                  onStartProduction={handleStartProduction}
                  onPause={handlePause}
                  onResume={handleResume}
                  onComplete={openCompleteDialog}
                  getStatusBadge={getStatusBadge}
                  getProgressPercentage={getProgressPercentage}
                  isPending={{
                    start: startOperation.isPending,
                    pause: pauseWorkOrder.isPending,
                    resume: resumeWorkOrder.isPending
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Complete Dialog */}
      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isRTL ? 'تسجيل الإنتاج' : 'Report Production Output'}</DialogTitle>
            <DialogDescription>
              {isRTL 
                ? `أمر العمل: ${selectedWorkOrder?.work_order_number}`
                : `Work Order: ${selectedWorkOrder?.work_order_number}`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{isRTL ? 'الكمية المنتجة (جيدة)' : 'Good Quantity Produced'}</Label>
              <Input
                type="number"
                value={quantityProduced}
                onChange={(e) => setQuantityProduced(Number(e.target.value))}
                min={0}
                max={selectedWorkOrder ? selectedWorkOrder.planned_quantity - selectedWorkOrder.completed_quantity : 0}
              />
            </div>
            
            <div className="space-y-2">
              <Label>{isRTL ? 'الكمية التالفة (خردة)' : 'Scrapped Quantity'}</Label>
              <Input
                type="number"
                value={quantityScrapped}
                onChange={(e) => setQuantityScrapped(Number(e.target.value))}
                min={0}
              />
            </div>

            <div className="space-y-2">
              <Label>{isRTL ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isRTL ? 'أي ملاحظات إضافية...' : 'Any additional notes...'}
              />
            </div>

            {quantityScrapped > 0 && (
              <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                <span className="text-sm text-yellow-700 dark:text-yellow-400">
                  {(() => {
                    if (isRTL) {
                      return `سيتم تسجيل ${quantityScrapped} وحدة كخردة`
                    }
                    return `${quantityScrapped} unit(s) will be recorded as scrap`
                  })()}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>
              {isRTL ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button 
              onClick={handleComplete}
              disabled={completeOperation.isPending || quantityProduced <= 0}
            >
              {completeOperation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              {isRTL ? 'تأكيد' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default WorkCenterDashboard

