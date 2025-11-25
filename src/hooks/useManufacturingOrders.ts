// src/hooks/useManufacturingOrders.ts
// React Query hooks for manufacturing orders
// ✅ Updated to use manufacturingService.getAll for better performance

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { manufacturingService } from '@/services/supabase-service'
import { getSupabase, type ManufacturingOrder } from '@/lib/supabase'

export const useManufacturingOrders = () => {
  return useQuery({
    queryKey: ['manufacturing-orders'],
    queryFn: async () => manufacturingService.getAll(),
    // Performance optimization: Cache for 5 minutes
    staleTime: 5 * 60 * 1000, // Data stays fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes (formerly cacheTime)
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnMount: false, // Don't refetch on component mount if data exists
  })
}

export const useCreateManufacturingOrder = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (order: Omit<ManufacturingOrder, 'id' | 'created_at' | 'updated_at'>) => {
      const supabase = getSupabase()
      if (!supabase) throw new Error('Supabase client not initialized')
      const { data, error } = await supabase
        .from('manufacturing_orders')
        .insert(order)
        .select()
        .single()
      
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] })
    },
  })
}