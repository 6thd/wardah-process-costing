/**
 * Efficiency Hooks - React Query hooks for Efficiency Reports
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { efficiencyService } from '@/services/manufacturing/efficiencyService'
import { useToast } from '@/components/ui/use-toast'

// Query Keys
export const efficiencyKeys = {
  all: ['efficiency'] as const,
  laborEfficiency: (filters?: Record<string, unknown>) => [...efficiencyKeys.all, 'labor', filters] as const,
  workCenterSummary: (filters?: Record<string, unknown>) => [...efficiencyKeys.all, 'wcSummary', filters] as const,
  efficiencySummary: (startDate: string, endDate: string, wcId?: string) => [...efficiencyKeys.all, 'summary', startDate, endDate, wcId] as const,
  costVariance: (filters?: Record<string, unknown>) => [...efficiencyKeys.all, 'costVariance', filters] as const,
  totalVariances: (startDate: string, endDate: string) => [...efficiencyKeys.all, 'totalVariances', startDate, endDate] as const,
  materialConsumption: (filters?: Record<string, unknown>) => [...efficiencyKeys.all, 'materials', filters] as const,
  totalConsumption: (startDate: string, endDate: string) => [...efficiencyKeys.all, 'totalConsumption', startDate, endDate] as const,
  oee: (filters?: Record<string, unknown>) => [...efficiencyKeys.all, 'oee', filters] as const,
  oeeSummary: (startDate: string, endDate: string, wcId?: string) => [...efficiencyKeys.all, 'oeeSummary', startDate, endDate, wcId] as const,
  overallOEE: (startDate: string, endDate: string) => [...efficiencyKeys.all, 'overallOEE', startDate, endDate] as const,
  dashboardStats: () => [...efficiencyKeys.all, 'dashboard'] as const,
}

// =====================================================
// Labor Efficiency Queries
// =====================================================

/**
 * Hook للحصول على تقرير كفاءة العمالة
 */
export function useLaborEfficiencyReport(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}) {
  return useQuery({
    queryKey: efficiencyKeys.laborEfficiency(filters),
    queryFn: () => efficiencyService.getLaborEfficiencyReport(filters),
  })
}

/**
 * Hook للحصول على ملخص كفاءة مركز العمل
 */
export function useWorkCenterEfficiencySummary(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}) {
  return useQuery({
    queryKey: efficiencyKeys.workCenterSummary(filters),
    queryFn: () => efficiencyService.getWorkCenterEfficiencySummary(filters),
  })
}

/**
 * Hook للحصول على ملخص الكفاءة
 */
export function useEfficiencySummary(startDate: string, endDate: string, workCenterId?: string) {
  return useQuery({
    queryKey: efficiencyKeys.efficiencySummary(startDate, endDate, workCenterId),
    queryFn: () => efficiencyService.getEfficiencySummary(startDate, endDate, workCenterId),
    enabled: !!startDate && !!endDate,
  })
}

// =====================================================
// Cost Variance Queries
// =====================================================

/**
 * Hook للحصول على تقرير تباين التكاليف
 */
export function useCostVarianceReport(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}) {
  return useQuery({
    queryKey: efficiencyKeys.costVariance(filters),
    queryFn: () => efficiencyService.getCostVarianceReport(filters),
  })
}

/**
 * Hook للحصول على إجمالي التباينات
 */
export function useTotalVariances(startDate: string, endDate: string) {
  return useQuery({
    queryKey: efficiencyKeys.totalVariances(startDate, endDate),
    queryFn: () => efficiencyService.getTotalVariances(startDate, endDate),
    enabled: !!startDate && !!endDate,
  })
}

// =====================================================
// Material Consumption Queries
// =====================================================

/**
 * Hook للحصول على تقرير استهلاك المواد
 */
export function useMaterialConsumptionReport(filters?: {
  moId?: string
  itemId?: string
  fromDate?: string
  toDate?: string
}) {
  return useQuery({
    queryKey: efficiencyKeys.materialConsumption(filters),
    queryFn: () => efficiencyService.getMaterialConsumptionReport(filters),
  })
}

/**
 * Hook للحصول على إجمالي استهلاك المواد
 */
export function useTotalMaterialConsumption(startDate: string, endDate: string) {
  return useQuery({
    queryKey: efficiencyKeys.totalConsumption(startDate, endDate),
    queryFn: () => efficiencyService.getTotalMaterialConsumption(startDate, endDate),
    enabled: !!startDate && !!endDate,
  })
}

// =====================================================
// OEE Queries
// =====================================================

/**
 * Hook للحصول على تقرير OEE
 */
export function useOEEReport(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}) {
  return useQuery({
    queryKey: efficiencyKeys.oee(filters),
    queryFn: () => efficiencyService.getOEEReport(filters),
  })
}

/**
 * Hook للحصول على ملخص OEE
 */
export function useOEESummary(startDate: string, endDate: string, workCenterId?: string) {
  return useQuery({
    queryKey: efficiencyKeys.oeeSummary(startDate, endDate, workCenterId),
    queryFn: () => efficiencyService.getOEESummary(startDate, endDate, workCenterId),
    enabled: !!startDate && !!endDate,
  })
}

/**
 * Hook للحصول على متوسط OEE للمنشأة
 */
export function useOverallOEE(startDate: string, endDate: string) {
  return useQuery({
    queryKey: efficiencyKeys.overallOEE(startDate, endDate),
    queryFn: () => efficiencyService.getOverallOEE(startDate, endDate),
    enabled: !!startDate && !!endDate,
  })
}

// =====================================================
// Dashboard Stats
// =====================================================

/**
 * Hook للحصول على إحصائيات لوحة التحكم
 */
export function useDashboardStats() {
  return useQuery({
    queryKey: efficiencyKeys.dashboardStats(),
    queryFn: () => efficiencyService.getDashboardStats(),
    refetchInterval: 60000, // تحديث كل دقيقة
  })
}

// =====================================================
// Mutations
// =====================================================

/**
 * Hook لتعيين مسار لأمر التصنيع
 */
export function useAssignRoutingToMO() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ moId, routingId }: { moId: string; routingId: string }) =>
      efficiencyService.assignRoutingToMO(moId, routingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
      toast({
        title: 'تم التعيين',
        description: 'تم تعيين مسار التصنيع بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تعيين المسار',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لإطلاق أمر التصنيع
 */
export function useReleaseManufacturingOrder() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: (moId: string) => efficiencyService.releaseManufacturingOrder(moId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
      queryClient.invalidateQueries({ queryKey: ['mes'] })
      toast({
        title: 'تم الإطلاق',
        description: 'تم إطلاق أمر التصنيع وإنشاء أوامر العمل بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إطلاق أمر التصنيع',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لتحديث إعدادات Backflushing
 */
export function useUpdateBackflushSettings() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ moId, settings }: {
      moId: string
      settings: {
        auto_backflush: boolean
        backflush_timing: 'ON_START' | 'ON_COMPLETION' | 'MANUAL'
      }
    }) => efficiencyService.updateBackflushSettings(moId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث إعدادات Backflushing بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تحديث الإعدادات',
        variant: 'destructive',
      })
    },
  })
}

