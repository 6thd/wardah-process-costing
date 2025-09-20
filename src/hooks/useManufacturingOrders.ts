// src/hooks/useManufacturingOrders.ts
// React Query hooks for manufacturing orders

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, withOrgContext } from '@/lib/supabase'
import { ManufacturingOrder } from '@/types/manufacturing'

export const useManufacturingOrders = () => {
  return useQuery({
    queryKey: ['manufacturing-orders'],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      const { data, error } = await withOrgContext(
        supabase.from('manufacturing_orders').select('*')
      )
      
      if (error) throw error
      return data as ManufacturingOrder[]
    },
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