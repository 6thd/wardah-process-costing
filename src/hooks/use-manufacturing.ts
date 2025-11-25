import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { manufacturingService, processCostService } from '../services/supabase-service'
import type { ManufacturingOrder, ProcessCost } from '../lib/supabase'
import { useAuthStore } from '../store/auth-store'

export function useManufacturingOrders() {
  return useQuery({
    queryKey: ['manufacturing-orders'],
    queryFn: async () => manufacturingService.getAll(),
  })
}

export function useManufacturingOrder(id: string) {
  return useQuery({
    queryKey: ['manufacturing-orders', id],
    queryFn: () => manufacturingService.getById(id),
    enabled: !!id,
  })
}

export function useCreateManufacturingOrder() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  
  return useMutation({
    mutationFn: (order: Omit<ManufacturingOrder, 'id' | 'created_at' | 'updated_at' | 'created_by'>) => 
      manufacturingService.create({
        ...order,
        created_by: user?.id || ''
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
    },
  })
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ManufacturingOrder['status'] }) => 
      manufacturingService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
    },
  })
}

export function useProcessCosts(manufacturingOrderId: string) {
  return useQuery({
    queryKey: ['process-costs', manufacturingOrderId],
    queryFn: () => processCostService.getByOrderId(manufacturingOrderId),
    enabled: !!manufacturingOrderId,
  })
}

export function useCreateProcessCost() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (processCost: Omit<ProcessCost, 'id' | 'created_at'>) => 
      processCostService.create(processCost),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ['process-costs', variables.manufacturing_order_id] 
      })
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
    },
  })
}