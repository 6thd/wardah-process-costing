/**
 * MES Hooks - React Query hooks for Manufacturing Execution System
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mesService, WorkOrder, WorkOrderStatus, OperationEventType, LaborTimeTracking, QualityInspection, MaterialConsumption, MachineDowntime } from '@/services/manufacturing/mesService'
import { useToast } from '@/hooks/use-toast'

// Query Keys
export const mesKeys = {
  all: ['mes'] as const,
  workOrders: () => [...mesKeys.all, 'workOrders'] as const,
  workOrderList: (filters?: Record<string, unknown>) => [...mesKeys.workOrders(), 'list', filters] as const,
  workOrderDetail: (id: string) => [...mesKeys.workOrders(), 'detail', id] as const,
  operationLogs: (workOrderId: string) => [...mesKeys.all, 'logs', workOrderId] as const,
  laborTime: (workOrderId: string) => [...mesKeys.all, 'labor', workOrderId] as const,
  quality: (workOrderId: string) => [...mesKeys.all, 'quality', workOrderId] as const,
  materials: (workOrderId: string) => [...mesKeys.all, 'materials', workOrderId] as const,
  downtime: (workCenterId: string) => [...mesKeys.all, 'downtime', workCenterId] as const,
  workCenterSummary: (workCenterId: string) => [...mesKeys.all, 'summary', workCenterId] as const,
}

// =====================================================
// Work Order Queries
// =====================================================

/**
 * Hook للحصول على أوامر العمل
 */
export function useWorkOrders(filters?: {
  moId?: string
  workCenterId?: string
  status?: WorkOrderStatus | WorkOrderStatus[]
  fromDate?: string
  toDate?: string
}) {
  return useQuery({
    queryKey: mesKeys.workOrderList(filters),
    queryFn: () => mesService.getWorkOrders(filters),
  })
}

/**
 * Hook للحصول على أمر عمل بالمعرف
 */
export function useWorkOrder(id: string) {
  return useQuery({
    queryKey: mesKeys.workOrderDetail(id),
    queryFn: () => mesService.getWorkOrderById(id),
    enabled: !!id,
  })
}

/**
 * Hook للحصول على سجلات التنفيذ
 */
export function useOperationLogs(workOrderId: string) {
  return useQuery({
    queryKey: mesKeys.operationLogs(workOrderId),
    queryFn: () => mesService.getOperationLogs(workOrderId),
    enabled: !!workOrderId,
  })
}

/**
 * Hook للحصول على سجلات وقت العمل
 */
export function useLaborTimeRecords(workOrderId: string) {
  return useQuery({
    queryKey: mesKeys.laborTime(workOrderId),
    queryFn: () => mesService.getLaborTimeRecords(workOrderId),
    enabled: !!workOrderId,
  })
}

/**
 * Hook للحصول على فحوصات الجودة
 */
export function useQualityInspections(workOrderId: string) {
  return useQuery({
    queryKey: mesKeys.quality(workOrderId),
    queryFn: () => mesService.getQualityInspections(workOrderId),
    enabled: !!workOrderId,
  })
}

/**
 * Hook للحصول على استهلاك المواد
 */
export function useMaterialConsumption(workOrderId: string) {
  return useQuery({
    queryKey: mesKeys.materials(workOrderId),
    queryFn: () => mesService.getMaterialConsumption(workOrderId),
    enabled: !!workOrderId,
  })
}

/**
 * Hook للحصول على سجلات التوقف
 */
export function useMachineDowntime(workCenterId: string, fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: mesKeys.downtime(workCenterId),
    queryFn: () => mesService.getMachineDowntime(workCenterId, fromDate, toDate),
    enabled: !!workCenterId,
  })
}

/**
 * Hook للحصول على ملخص مركز العمل
 */
export function useWorkCenterSummary(workCenterId: string) {
  return useQuery({
    queryKey: mesKeys.workCenterSummary(workCenterId),
    queryFn: () => mesService.getWorkCenterSummary(workCenterId),
    enabled: !!workCenterId,
    refetchInterval: 30000, // تحديث كل 30 ثانية
  })
}

// =====================================================
// Work Order Mutations
// =====================================================

/**
 * Hook لإنشاء أوامر عمل من أمر تصنيع
 */
export function useGenerateWorkOrders() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: (moId: string) => mesService.generateWorkOrdersFromMO(moId),
    onSuccess: (data: WorkOrder[]) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrders() })
      toast({
        title: 'تم إنشاء أوامر العمل',
        description: `تم إنشاء ${data.length} أمر عمل بنجاح`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إنشاء أوامر العمل',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لبدء عملية
 */
export function useStartOperation() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, operatorId, isSetup }: { 
      workOrderId: string
      operatorId?: string
      isSetup?: boolean 
    }) => mesService.startOperation(workOrderId, operatorId, isSetup),
    onSuccess: (data: WorkOrder) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrders() })
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrderDetail(data.id) })
      toast({
        title: 'تم بدء العملية',
        description: 'تم بدء العملية بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في بدء العملية',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لإنهاء عملية
 */
export function useCompleteOperation() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, quantityProduced, quantityScrapped, notes }: {
      workOrderId: string
      quantityProduced: number
      quantityScrapped?: number
      notes?: string
    }) => mesService.completeOperation(workOrderId, quantityProduced, quantityScrapped, notes),
    onSuccess: (data: WorkOrder) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrders() })
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrderDetail(data.id) })
      toast({
        title: 'تم إنهاء العملية',
        description: 'تم تسجيل الكمية المنتجة بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إنهاء العملية',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لتحديث حالة أمر العمل
 */
export function useUpdateWorkOrderStatus() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, status, notes }: {
      workOrderId: string
      status: WorkOrderStatus
      notes?: string
    }) => mesService.updateWorkOrderStatus(workOrderId, status, notes),
    onSuccess: (data: WorkOrder) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrders() })
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrderDetail(data.id) })
      toast({
        title: 'تم تحديث الحالة',
        description: 'تم تحديث حالة أمر العمل بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تحديث الحالة',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لإيقاف مؤقت
 */
export function usePauseWorkOrder() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, reason }: { workOrderId: string; reason?: string }) => 
      mesService.pauseWorkOrder(workOrderId, reason),
    onSuccess: (data: WorkOrder) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrders() })
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrderDetail(data.id) })
      toast({
        title: 'تم الإيقاف',
        description: 'تم إيقاف العملية مؤقتاً',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إيقاف العملية',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook للاستئناف
 */
export function useResumeWorkOrder() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, operatorId }: { workOrderId: string; operatorId?: string }) => 
      mesService.resumeWorkOrder(workOrderId, operatorId),
    onSuccess: (data: WorkOrder) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrders() })
      queryClient.invalidateQueries({ queryKey: mesKeys.workOrderDetail(data.id) })
      toast({
        title: 'تم الاستئناف',
        description: 'تم استئناف العملية بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في استئناف العملية',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Operation Log Mutations
// =====================================================

/**
 * Hook لإضافة سجل تنفيذ
 */
export function useAddOperationLog() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ workOrderId, eventType, data }: {
      workOrderId: string
      eventType: OperationEventType
      data?: {
        quantityProduced?: number
        quantityScrapped?: number
        reasonCode?: string
        reasonDescription?: string
        notes?: string
      }
    }) => mesService.addOperationLog(workOrderId, eventType, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.operationLogs(variables.workOrderId) })
    },
  })
}

// =====================================================
// Labor Time Mutations
// =====================================================

/**
 * Hook لتسجيل دخول عامل
 */
export function useClockIn() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, employeeId, laborType, hourlyRate }: {
      workOrderId: string
      employeeId: string
      laborType?: LaborTimeTracking['labor_type']
      hourlyRate?: number
    }) => mesService.clockIn(workOrderId, employeeId, laborType, hourlyRate),
    onSuccess: (data: LaborTimeTracking) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.laborTime(data.work_order_id) })
      toast({
        title: 'تم تسجيل الدخول',
        description: 'تم تسجيل دخول العامل بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تسجيل الدخول',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لتسجيل خروج عامل
 */
export function useClockOut() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ laborTrackingId, breakMinutes }: {
      laborTrackingId: string
      breakMinutes?: number
    }) => mesService.clockOut(laborTrackingId, breakMinutes),
    onSuccess: (data: LaborTimeTracking) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.laborTime(data.work_order_id) })
      toast({
        title: 'تم تسجيل الخروج',
        description: 'تم تسجيل خروج العامل بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تسجيل الخروج',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Quality Mutations
// =====================================================

/**
 * Hook لإنشاء فحص جودة
 */
export function useCreateQualityInspection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, inspectionData }: {
      workOrderId: string
      inspectionData: {
        inspection_type: QualityInspection['inspection_type']
        sample_size: number
        passed_quantity: number
        failed_quantity: number
        result: QualityInspection['result']
        specifications?: string
        findings?: string
        corrective_action?: string
      }
    }) => mesService.createQualityInspection(workOrderId, inspectionData),
    onSuccess: (data: QualityInspection) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.quality(data.work_order_id) })
      toast({
        title: 'تم إنشاء الفحص',
        description: 'تم تسجيل فحص الجودة بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إنشاء فحص الجودة',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Material Mutations
// =====================================================

/**
 * Hook لـ Backflushing
 */
export function useBackflushMaterials() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, quantityProduced }: {
      workOrderId: string
      quantityProduced: number
    }) => mesService.backflushMaterials(workOrderId, quantityProduced),
    onSuccess: (data: MaterialConsumption[], variables) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.materials(variables.workOrderId) })
      toast({
        title: 'تم استهلاك المواد',
        description: `تم استهلاك ${data.length} مادة آلياً`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في استهلاك المواد',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لاستهلاك مواد يدوي
 */
export function useConsumeMaterial() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, itemId, quantity, unitCost, notes }: {
      workOrderId: string
      itemId: string
      quantity: number
      unitCost?: number
      notes?: string
    }) => mesService.consumeMaterial(workOrderId, itemId, quantity, unitCost, notes),
    onSuccess: (data: MaterialConsumption) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.materials(data.work_order_id) })
      toast({
        title: 'تم استهلاك المادة',
        description: 'تم تسجيل استهلاك المادة بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في استهلاك المادة',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Downtime Mutations
// =====================================================

/**
 * Hook لتسجيل توقف آلة
 */
export function useReportMachineDown() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workCenterId, reason, category, workOrderId, notes }: {
      workCenterId: string
      reason: string
      category: MachineDowntime['downtime_category']
      workOrderId?: string
      notes?: string
    }) => mesService.reportMachineDown(workCenterId, reason, category, workOrderId, notes),
    onSuccess: (data: MachineDowntime) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.downtime(data.work_center_id) })
      toast({
        title: 'تم تسجيل التوقف',
        description: 'تم تسجيل توقف الآلة بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تسجيل التوقف',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لإنهاء توقف آلة
 */
export function useResolveMachineDown() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ downtimeId, actionTaken }: {
      downtimeId: string
      actionTaken?: string
    }) => mesService.resolveMachineDown(downtimeId, actionTaken),
    onSuccess: (data: MachineDowntime) => {
      queryClient.invalidateQueries({ queryKey: mesKeys.downtime(data.work_center_id) })
      toast({
        title: 'تم حل المشكلة',
        description: 'تم إنهاء توقف الآلة بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إنهاء التوقف',
        variant: 'destructive',
      })
    },
  })
}

