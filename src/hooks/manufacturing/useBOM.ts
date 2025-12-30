/**
 * Custom Hooks for BOM Management
 * React Query hooks for Bill of Materials
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { bomService, BOMHeader, BOMLine } from '@/services/manufacturing/bomService'
import { toast } from 'sonner'

/**
 * Hook للحصول على جميع BOMs
 */
export function useBOMs(orgId: string) {
  return useQuery({
    queryKey: ['boms', orgId],
    queryFn: () => bomService.getAllBOMs(orgId),
    enabled: !!orgId
  })
}

/**
 * Hook للحصول على BOM واحد
 */
export function useBOM(bomId: string | undefined) {
  return useQuery({
    queryKey: ['bom', bomId],
    queryFn: () => {
      if (!bomId) throw new Error('BOM ID is required')
      return bomService.getBOMById(bomId)
    },
    enabled: !!bomId
  })
}

/**
 * Hook لإنشاء BOM جديد
 */
export function useCreateBOM(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      header,
      lines
    }: {
      header: Omit<BOMHeader, 'id' | 'created_at' | 'updated_at'>
      lines: Omit<BOMLine, 'id' | 'bom_id'>[]
    }) => {
      return bomService.createBOM(header, lines)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boms', orgId] })
      toast.success('تم إنشاء قائمة المواد بنجاح', {
        description: 'BOM created successfully'
      })
    },
    onError: (error: any) => {
      toast.error('فشل في إنشاء قائمة المواد', {
        description: error.message
      })
    }
  })
}

/**
 * Hook لتحديث BOM
 */
export function useUpdateBOM(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      bomId,
      header,
      lines
    }: {
      bomId: string
      header: Partial<BOMHeader>
      lines?: BOMLine[]
    }) => {
      return bomService.updateBOM(bomId, header, lines)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bom', variables.bomId] })
      queryClient.invalidateQueries({ queryKey: ['boms', orgId] })
      toast.success('تم تحديث قائمة المواد بنجاح', {
        description: 'BOM updated successfully'
      })
    },
    onError: (error: any) => {
      toast.error('فشل في تحديث قائمة المواد', {
        description: error.message
      })
    }
  })
}

/**
 * Hook لحذف BOM
 */
export function useDeleteBOM(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bomId: string) => bomService.deleteBOM(bomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boms', orgId] })
      toast.success('تم حذف قائمة المواد بنجاح', {
        description: 'BOM deleted successfully'
      })
    },
    onError: (error: any) => {
      toast.error('فشل في حذف قائمة المواد', {
        description: error.message
      })
    }
  })
}

/**
 * Hook للموافقة على BOM
 */
export function useApproveBOM(orgId: string, userId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bomId: string) => bomService.approveBOM(bomId, userId),
    onSuccess: (_, bomId) => {
      queryClient.invalidateQueries({ queryKey: ['bom', bomId] })
      queryClient.invalidateQueries({ queryKey: ['boms', orgId] })
      toast.success('تم اعتماد قائمة المواد', {
        description: 'BOM approved successfully'
      })
    },
    onError: (error: any) => {
      toast.error('فشل في اعتماد قائمة المواد', {
        description: error.message
      })
    }
  })
}

/**
 * Hook لفك BOM (Explosion)
 */
export function useBOMExplosion(bomId: string | undefined, quantity: number = 1, orgId?: string) {
  return useQuery({
    queryKey: ['bom-explosion', bomId, quantity, orgId],
    queryFn: () => {
      if (!bomId) throw new Error('BOM ID is required')
      return bomService.explodeBOM(bomId, quantity, orgId)
    },
    enabled: !!bomId
  })
}

/**
 * Hook لحساب تكلفة BOM
 */
export function useBOMCost(bomId: string | undefined, quantity: number = 1) {
  return useQuery({
    queryKey: ['bom-cost', bomId, quantity],
    queryFn: () => {
      if (!bomId) throw new Error('BOM ID is required')
      return bomService.calculateBOMCost(bomId, quantity)
    },
    enabled: !!bomId
  })
}

/**
 * Hook للـ Where-Used Report
 */
export function useWhereUsed(itemId: string | undefined, orgId?: string) {
  return useQuery({
    queryKey: ['where-used', itemId, orgId],
    queryFn: () => {
      if (!itemId) throw new Error('Item ID is required')
      return bomService.getWhereUsed(itemId, orgId)
    },
    enabled: !!itemId
  })
}

/**
 * Hook للحصول على إصدارات BOM
 */
export function useBOMVersions(bomId: string | undefined) {
  return useQuery({
    queryKey: ['bom-versions', bomId],
    queryFn: () => {
      if (!bomId) throw new Error('BOM ID is required')
      return bomService.getBOMVersions(bomId)
    },
    enabled: !!bomId
  })
}

/**
 * Hook لنسخ BOM
 */
export function useCopyBOM(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sourceBomId,
      newBomNumber
    }: {
      sourceBomId: string
      newBomNumber: string
    }) => {
      return bomService.copyBOM(sourceBomId, newBomNumber, orgId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boms', orgId] })
      toast.success('تم نسخ قائمة المواد بنجاح', {
        description: 'BOM copied successfully'
      })
    },
    onError: (error: any) => {
      toast.error('فشل في نسخ قائمة المواد', {
        description: error.message
      })
    }
  })
}

/**
 * Hook للبحث في BOMs
 */
export function useSearchBOMs(orgId: string, searchTerm: string) {
  return useQuery({
    queryKey: ['boms-search', orgId, searchTerm],
    queryFn: () => bomService.searchBOMs(orgId, searchTerm),
    enabled: !!orgId && searchTerm.length >= 2
  })
}
