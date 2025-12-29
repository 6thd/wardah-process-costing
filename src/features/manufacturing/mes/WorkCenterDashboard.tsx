/**
 * Work Center Dashboard - لوحة تحكم مركز العمل (MES)
 * واجهة مشغل مركز العمل
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Play,
  Pause,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Clock,
  Package,
  Activity,
  Wrench,
  Factory,
  Timer,
  TrendingUp,
} from 'lucide-react'
import { useWorkOrders, useStartOperation, useCompleteOperation, usePauseWorkOrder, useResumeWorkOrder, useWorkCenterSummary } from '@/hooks/manufacturing/useMES'
import { WorkOrder } from '@/services/manufacturing/mesService'
import { useQuery } from '@tanstack/react-query'
import { supabase, getEffectiveTenantId } from '@/lib/supabase'

export function WorkCenterDashboard() {
  const { t, i18n } = useTranslation()
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="secondary">{isRTL ? 'في الانتظار' : 'Pending'}</Badge>
      case 'READY':
        return <Badge className="bg-blue-500">{isRTL ? 'جاهز' : 'Ready'}</Badge>
      case 'IN_SETUP':
        return <Badge className="bg-yellow-500">{isRTL ? 'إعداد' : 'Setup'}</Badge>
      case 'IN_PROGRESS':
        return <Badge className="bg-green-500">{isRTL ? 'قيد التنفيذ' : 'In Progress'}</Badge>
      case 'ON_HOLD':
        return <Badge className="bg-orange-500">{isRTL ? 'معلق' : 'On Hold'}</Badge>
      case 'COMPLETED':
        return <Badge className="bg-purple-500">{isRTL ? 'مكتمل' : 'Completed'}</Badge>
      default:
        return <Badge>{status}</Badge>
    }
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
          ) : workOrders?.length === 0 ? (
            <div className="text-center py-12">
              <Factory className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-2 text-lg font-medium">{isRTL ? 'لا توجد أوامر عمل' : 'No Work Orders'}</h3>
              <p className="mt-1 text-muted-foreground">
                {isRTL ? 'لا توجد أوامر عمل نشطة لمركز العمل هذا' : 'No active work orders for this work center'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {workOrders?.map((wo: WorkOrder) => (
                <Card key={wo.id} className="border-2">
                  <CardContent className="p-4">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      {/* Work Order Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-bold text-lg">{wo.work_order_number}</span>
                          {getStatusBadge(wo.status)}
                          <Badge variant="outline">#{wo.operation_sequence}</Badge>
                        </div>
                        <p className="text-muted-foreground">
                          {isRTL ? wo.operation_name_ar || wo.operation_name : wo.operation_name}
                        </p>
                        
                        {/* Progress */}
                        <div className="mt-3">
                          <div className="flex justify-between text-sm mb-1">
                            <span>{isRTL ? 'التقدم' : 'Progress'}</span>
                            <span>{wo.completed_quantity} / {wo.planned_quantity}</span>
                          </div>
                          <Progress value={getProgressPercentage(wo)} className="h-2" />
                        </div>

                        {/* Times */}
                        <div className="flex gap-4 mt-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Timer className="w-4 h-4" />
                            <span>{isRTL ? 'إعداد:' : 'Setup:'} {wo.actual_setup_time || 0}/{wo.planned_setup_time} {isRTL ? 'د' : 'min'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span>{isRTL ? 'تشغيل:' : 'Run:'} {wo.actual_run_time || 0}/{wo.planned_run_time} {isRTL ? 'د' : 'min'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2">
                        {(wo.status === 'PENDING' || wo.status === 'READY') && (
                          <Button
                            onClick={() => handleStartSetup(wo)}
                            disabled={startOperation.isPending}
                            className="bg-blue-500 hover:bg-blue-600"
                          >
                            <Play className="w-4 h-4 mr-2" />
                            {isRTL ? 'بدء الإعداد' : 'Start Setup'}
                          </Button>
                        )}

                        {wo.status === 'IN_SETUP' && (
                          <Button
                            onClick={() => handleStartProduction(wo)}
                            disabled={startOperation.isPending}
                            className="bg-green-500 hover:bg-green-600"
                          >
                            <Play className="w-4 h-4 mr-2" />
                            {isRTL ? 'بدء الإنتاج' : 'Start Production'}
                          </Button>
                        )}

                        {wo.status === 'IN_PROGRESS' && (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => handlePause(wo)}
                              disabled={pauseWorkOrder.isPending}
                            >
                              <Pause className="w-4 h-4 mr-2" />
                              {isRTL ? 'إيقاف' : 'Pause'}
                            </Button>
                            <Button
                              onClick={() => openCompleteDialog(wo)}
                              className="bg-purple-500 hover:bg-purple-600"
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              {isRTL ? 'تسجيل إنتاج' : 'Report Output'}
                            </Button>
                          </>
                        )}

                        {wo.status === 'ON_HOLD' && (
                          <Button
                            onClick={() => handleResume(wo)}
                            disabled={resumeWorkOrder.isPending}
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
                  {isRTL 
                    ? `سيتم تسجيل ${quantityScrapped} وحدة كخردة`
                    : `${quantityScrapped} unit(s) will be recorded as scrap`
                  }
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

