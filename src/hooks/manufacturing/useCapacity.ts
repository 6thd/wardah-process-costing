/**
 * Capacity Planning Hooks - React Query hooks for Capacity Planning
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { capacityService, WorkCenterLoad, ProductionSchedule, ScheduleDetail, BottleneckAnalysis, CapacitySummary } from '@/services/manufacturing/capacityService'
import { useToast } from '@/hooks/use-toast'

// Query Keys
export const capacityKeys = {
  all: ['capacity'] as const,
  calendar: (workCenterId: string, startDate: string, endDate: string) => 
    [...capacityKeys.all, 'calendar', workCenterId, startDate, endDate] as const,
  loads: (startDate: string, endDate: string) => 
    [...capacityKeys.all, 'loads', startDate, endDate] as const,
  bottlenecks: (startDate: string, endDate: string) => 
    [...capacityKeys.all, 'bottlenecks', startDate, endDate] as const,
  summary: () => [...capacityKeys.all, 'summary'] as const,
  schedules: () => [...capacityKeys.all, 'schedules'] as const,
  scheduleList: (filters?: Record<string, unknown>) => [...capacityKeys.schedules(), 'list', filters] as const,
  scheduleDetail: (id: string) => [...capacityKeys.schedules(), 'detail', id] as const,
  weeklySummary: () => [...capacityKeys.all, 'weekly'] as const,
  predictions: (daysAhead: number) => [...capacityKeys.all, 'predictions', daysAhead] as const,
}

// =====================================================
// Calendar Queries
// =====================================================

/**
 * Hook للحصول على تقويم مركز العمل
 */
export function useWorkCenterCalendar(
  workCenterId: string,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: capacityKeys.calendar(workCenterId, startDate, endDate),
    queryFn: () => capacityService.getWorkCenterCalendar(workCenterId, startDate, endDate),
    enabled: !!workCenterId && !!startDate && !!endDate,
  })
}

// =====================================================
// Capacity Queries
// =====================================================

/**
 * Hook للحصول على حمل مراكز العمل
 */
export function useWorkCenterLoads(startDate: string, endDate: string) {
  return useQuery({
    queryKey: capacityKeys.loads(startDate, endDate),
    queryFn: () => capacityService.getWorkCenterLoads(startDate, endDate),
    enabled: !!startDate && !!endDate,
  })
}

/**
 * Hook لتحديد الاختناقات
 */
export function useBottlenecks(startDate: string, endDate: string) {
  return useQuery({
    queryKey: capacityKeys.bottlenecks(startDate, endDate),
    queryFn: () => capacityService.identifyBottlenecks(startDate, endDate),
    enabled: !!startDate && !!endDate,
  })
}

/**
 * Hook للحصول على ملخص الطاقة
 */
export function useCapacitySummary() {
  return useQuery({
    queryKey: capacityKeys.summary(),
    queryFn: () => capacityService.getCapacitySummary(),
  })
}

// =====================================================
// Schedule Queries
// =====================================================

/**
 * Hook للحصول على جداول الإنتاج
 */
export function useProductionSchedules(filters?: {
  status?: ProductionSchedule['status']
  fromDate?: string
  toDate?: string
}) {
  return useQuery({
    queryKey: capacityKeys.scheduleList(filters),
    queryFn: () => capacityService.getProductionSchedules(filters),
  })
}

/**
 * Hook للحصول على جدول إنتاج بالمعرف
 */
export function useProductionSchedule(id: string) {
  return useQuery({
    queryKey: capacityKeys.scheduleDetail(id),
    queryFn: () => capacityService.getProductionScheduleById(id),
    enabled: !!id,
  })
}

/**
 * Hook للحصول على ملخص الجدولة الأسبوعية
 */
export function useWeeklyScheduleSummary() {
  return useQuery({
    queryKey: capacityKeys.weeklySummary(),
    queryFn: () => capacityService.getWeeklyScheduleSummary(),
    refetchInterval: 60000, // تحديث كل دقيقة
  })
}

/**
 * Hook للتنبؤ بالتأخيرات
 */
export function usePredictDelays(daysAhead: number = 7) {
  return useQuery({
    queryKey: capacityKeys.predictions(daysAhead),
    queryFn: () => capacityService.predictDelays(daysAhead),
  })
}

// =====================================================
// Calendar Mutations
// =====================================================

/**
 * Hook لتحديث يوم في التقويم
 */
export function useUpdateCalendarDay() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workCenterId, date, updates }: {
      workCenterId: string
      date: string
      updates: Parameters<typeof capacityService.updateCalendarDay>[2]
    }) => capacityService.updateCalendarDay(workCenterId, date, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.all })
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث التقويم بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تحديث التقويم',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لإضافة عطلة
 */
export function useAddHoliday() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workCenterId, date, holidayName }: {
      workCenterId: string
      date: string
      holidayName: string
    }) => capacityService.addHoliday(workCenterId, date, holidayName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.all })
      toast({
        title: 'تمت الإضافة',
        description: 'تمت إضافة العطلة بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إضافة العطلة',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لإضافة صيانة مخططة
 */
export function useAddPlannedMaintenance() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workCenterId, date, maintenanceHours, notes }: {
      workCenterId: string
      date: string
      maintenanceHours: number
      notes?: string
    }) => capacityService.addPlannedMaintenance(workCenterId, date, maintenanceHours, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.all })
      toast({
        title: 'تمت الإضافة',
        description: 'تمت إضافة الصيانة المخططة بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إضافة الصيانة',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Capacity Mutations
// =====================================================

/**
 * Hook لتحديث حمل مركز العمل
 */
export function useUpdateWorkCenterLoad() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workCenterId, startDate, endDate }: {
      workCenterId: string
      startDate: string
      endDate: string
    }) => capacityService.updateWorkCenterLoad(workCenterId, startDate, endDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.all })
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث حمل مركز العمل بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تحديث الحمل',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Schedule Mutations
// =====================================================

/**
 * Hook لإنشاء جدول إنتاج
 */
export function useCreateProductionSchedule() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: (scheduleData: {
      schedule_name?: string
      period_start: string
      period_end: string
      notes?: string
    }) => capacityService.createProductionSchedule(scheduleData),
    onSuccess: (data: ProductionSchedule) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      toast({
        title: 'تم الإنشاء',
        description: `تم إنشاء جدول الإنتاج ${data.schedule_number} بنجاح`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إنشاء جدول الإنتاج',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لتحديث جدول إنتاج
 */
export function useUpdateProductionSchedule() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ id, updates }: {
      id: string
      updates: Partial<{
        schedule_name: string
        period_start: string
        period_end: string
        status: ProductionSchedule['status']
        notes: string
      }>
    }) => capacityService.updateProductionSchedule(id, updates),
    onSuccess: (data: ProductionSchedule) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      queryClient.invalidateQueries({ queryKey: capacityKeys.scheduleDetail(data.id) })
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث جدول الإنتاج بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تحديث جدول الإنتاج',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook للموافقة على جدول إنتاج
 */
export function useApproveProductionSchedule() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => 
      capacityService.approveProductionSchedule(id, userId),
    onSuccess: (data: ProductionSchedule) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      queryClient.invalidateQueries({ queryKey: capacityKeys.scheduleDetail(data.id) })
      toast({
        title: 'تمت الموافقة',
        description: 'تمت الموافقة على جدول الإنتاج بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في الموافقة على الجدول',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لحذف جدول إنتاج
 */
export function useDeleteProductionSchedule() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: (id: string) => capacityService.deleteProductionSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      toast({
        title: 'تم الحذف',
        description: 'تم حذف جدول الإنتاج بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حذف جدول الإنتاج',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Scheduling Mutations
// =====================================================

/**
 * Hook لجدولة أمر عمل
 */
export function useScheduleWorkOrder() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workOrderId, scheduledStart, scheduleId }: {
      workOrderId: string
      scheduledStart: string
      scheduleId?: string
    }) => capacityService.scheduleWorkOrder(workOrderId, scheduledStart, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      toast({
        title: 'تمت الجدولة',
        description: 'تمت جدولة أمر العمل بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في جدولة أمر العمل',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook للجدولة التلقائية
 */
export function useAutoScheduleWorkOrders() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ workCenterId, startDate, scheduleId }: {
      workCenterId: string
      startDate: string
      scheduleId?: string
    }) => capacityService.autoScheduleWorkOrders(workCenterId, startDate, scheduleId),
    onSuccess: (count: number) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      toast({
        title: 'تمت الجدولة',
        description: `تمت جدولة ${count} أمر عمل بنجاح`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في الجدولة التلقائية',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لتحديث حالة عنصر الجدول
 */
export function useUpdateScheduleDetailStatus() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ detailId, status, delayReason, delayHours }: {
      detailId: string
      status: ScheduleDetail['schedule_status']
      delayReason?: string
      delayHours?: number
    }) => capacityService.updateScheduleDetailStatus(detailId, status, delayReason, delayHours),
    onSuccess: (data: ScheduleDetail) => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث حالة العنصر بنجاح',
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
 * Hook لإعادة الجدولة
 */
export function useRescheduleWorkOrder() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ detailId, newScheduledStart }: {
      detailId: string
      newScheduledStart: string
    }) => capacityService.rescheduleWorkOrder(detailId, newScheduledStart),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capacityKeys.schedules() })
      toast({
        title: 'تمت إعادة الجدولة',
        description: 'تمت إعادة جدولة أمر العمل بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إعادة الجدولة',
        variant: 'destructive',
      })
    },
  })
}

