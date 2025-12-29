/**
 * Routing Hooks - React Query hooks for Routing operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { routingService, Routing, RoutingOperation, RoutingFormData, OperationFormData } from '@/services/manufacturing/routingService'
import { useToast } from '@/components/ui/use-toast'

// Query Keys
export const routingKeys = {
  all: ['routings'] as const,
  lists: () => [...routingKeys.all, 'list'] as const,
  list: (orgId?: string) => [...routingKeys.lists(), orgId] as const,
  details: () => [...routingKeys.all, 'detail'] as const,
  detail: (id: string) => [...routingKeys.details(), id] as const,
  byItem: (itemId: string) => [...routingKeys.all, 'item', itemId] as const,
  operations: (routingId: string) => [...routingKeys.all, 'operations', routingId] as const,
  calculations: (routingId: string, quantity: number) => [...routingKeys.all, 'calculations', routingId, quantity] as const,
}

// =====================================================
// Routing Queries
// =====================================================

/**
 * Hook للحصول على جميع مسارات التصنيع
 */
export function useRoutings(orgId?: string) {
  return useQuery({
    queryKey: routingKeys.list(orgId),
    queryFn: () => routingService.getRoutings(orgId),
  })
}

/**
 * Hook للحصول على مسار تصنيع بالمعرف
 */
export function useRouting(id: string) {
  return useQuery({
    queryKey: routingKeys.detail(id),
    queryFn: () => routingService.getRoutingById(id),
    enabled: !!id,
  })
}

/**
 * Hook للحصول على مسارات التصنيع لمنتج معين
 */
export function useRoutingsByItem(itemId: string) {
  return useQuery({
    queryKey: routingKeys.byItem(itemId),
    queryFn: () => routingService.getRoutingsByItem(itemId),
    enabled: !!itemId,
  })
}

/**
 * Hook للحصول على عمليات مسار التصنيع
 */
export function useRoutingOperations(routingId: string) {
  return useQuery({
    queryKey: routingKeys.operations(routingId),
    queryFn: () => routingService.getRoutingOperations(routingId),
    enabled: !!routingId,
  })
}

/**
 * Hook لحساب وقت وتكلفة المسار
 */
export function useRoutingCalculations(routingId: string, quantity: number = 1) {
  return useQuery({
    queryKey: routingKeys.calculations(routingId, quantity),
    queryFn: () => routingService.calculateRoutingTotals(routingId, quantity),
    enabled: !!routingId,
  })
}

// =====================================================
// Routing Mutations
// =====================================================

/**
 * Hook لإنشاء مسار تصنيع جديد
 */
export function useCreateRouting(orgId?: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: (data: RoutingFormData) => routingService.createRouting(data),
    onSuccess: (data: Routing) => {
      queryClient.invalidateQueries({ queryKey: routingKeys.lists() })
      toast({
        title: 'تم إنشاء المسار',
        description: `تم إنشاء مسار التصنيع ${data.routing_code} بنجاح`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إنشاء مسار التصنيع',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لتحديث مسار تصنيع
 */
export function useUpdateRouting() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RoutingFormData> }) => 
      routingService.updateRouting(id, data),
    onSuccess: (data: Routing) => {
      queryClient.invalidateQueries({ queryKey: routingKeys.lists() })
      queryClient.invalidateQueries({ queryKey: routingKeys.detail(data.id) })
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث مسار التصنيع بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تحديث مسار التصنيع',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لحذف مسار تصنيع
 */
export function useDeleteRouting(orgId?: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: (id: string) => routingService.deleteRouting(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: routingKeys.lists() })
      toast({
        title: 'تم الحذف',
        description: 'تم حذف مسار التصنيع بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حذف مسار التصنيع',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook للموافقة على مسار تصنيع
 */
export function useApproveRouting() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => 
      routingService.approveRouting(id, userId),
    onSuccess: (data: Routing) => {
      queryClient.invalidateQueries({ queryKey: routingKeys.lists() })
      queryClient.invalidateQueries({ queryKey: routingKeys.detail(data.id) })
      toast({
        title: 'تمت الموافقة',
        description: 'تمت الموافقة على مسار التصنيع بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في الموافقة على مسار التصنيع',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لنسخ مسار تصنيع
 */
export function useCopyRouting(orgId?: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ id, newCode, newVersion }: { id: string; newCode: string; newVersion?: number }) => 
      routingService.copyRouting(id, newCode, newVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: routingKeys.lists() })
      toast({
        title: 'تم النسخ',
        description: 'تم نسخ مسار التصنيع بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في نسخ مسار التصنيع',
        variant: 'destructive',
      })
    },
  })
}

// =====================================================
// Operation Mutations
// =====================================================

/**
 * Hook لإنشاء عملية جديدة
 */
export function useCreateOperation() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: (data: OperationFormData) => routingService.createOperation(data),
    onSuccess: (data: RoutingOperation) => {
      queryClient.invalidateQueries({ queryKey: routingKeys.operations(data.routing_id) })
      queryClient.invalidateQueries({ queryKey: routingKeys.detail(data.routing_id) })
      toast({
        title: 'تم إنشاء العملية',
        description: `تم إنشاء العملية ${data.operation_name} بنجاح`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إنشاء العملية',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لتحديث عملية
 */
export function useUpdateOperation() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OperationFormData> }) => 
      routingService.updateOperation(id, data),
    onSuccess: (data: RoutingOperation) => {
      queryClient.invalidateQueries({ queryKey: routingKeys.operations(data.routing_id) })
      queryClient.invalidateQueries({ queryKey: routingKeys.detail(data.routing_id) })
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث العملية بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في تحديث العملية',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لحذف عملية
 */
export function useDeleteOperation() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ id, routingId }: { id: string; routingId: string }) => {
      return routingService.deleteOperation(id).then(() => routingId)
    },
    onSuccess: (routingId: string) => {
      queryClient.invalidateQueries({ queryKey: routingKeys.operations(routingId) })
      queryClient.invalidateQueries({ queryKey: routingKeys.detail(routingId) })
      toast({
        title: 'تم الحذف',
        description: 'تم حذف العملية بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حذف العملية',
        variant: 'destructive',
      })
    },
  })
}

/**
 * Hook لإعادة ترتيب العمليات
 */
export function useReorderOperations() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  return useMutation({
    mutationFn: ({ routingId, operationIds }: { routingId: string; operationIds: string[] }) => 
      routingService.reorderOperations(routingId, operationIds).then(() => routingId),
    onSuccess: (routingId: string) => {
      queryClient.invalidateQueries({ queryKey: routingKeys.operations(routingId) })
      toast({
        title: 'تم إعادة الترتيب',
        description: 'تم إعادة ترتيب العمليات بنجاح',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في إعادة ترتيب العمليات',
        variant: 'destructive',
      })
    },
  })
}

