// src/hooks/useManufacturingOrders.ts
// React Query hooks for manufacturing orders

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, withOrgContext, type ManufacturingOrder } from '@/lib/supabase'

export const useManufacturingOrders = () => {
  return useQuery({
    queryKey: ['manufacturing-orders'],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      try {
        const { data, error } = await withOrgContext(
          supabase.from('manufacturing_orders').select('*')
        )
        
        // Handle missing table gracefully
        if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
          console.warn('manufacturing_orders table not found, returning empty array')
          return [] as ManufacturingOrder[]
        }
        
        if (error) throw error
        return (data || []) as ManufacturingOrder[]
      } catch (error: any) {
        // If table doesn't exist, return empty array
        if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
          console.warn('manufacturing_orders table not found, returning empty array')
          return [] as ManufacturingOrder[]
        }
        throw error
      }
    },
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