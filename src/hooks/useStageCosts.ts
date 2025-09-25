// src/hooks/useStageCosts.ts
// React Query hooks for stage costs

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/core/supabase'

export interface WorkCenter {
  id: string
  org_id: string
  code: string
  name: string
  name_ar: string
  description: string | null
  hourly_rate: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface StageCost {
  id: string
  org_id: string
  manufacturing_order_id: string
  stage_number: number
  work_center_id: string
  good_quantity: number
  defective_quantity: number | null
  material_cost: number
  labor_cost: number
  overhead_cost: number
  total_cost: number
  unit_cost: number
  status: 'precosted' | 'actual' | 'completed'
  created_at: string
  updated_at: string
  work_center?: WorkCenter
}

export const useStageCosts = (moId: string) => {
  return useQuery({
    queryKey: ['stage-costs', moId],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      const { data, error } = await supabase.from('stage_costs')
          .select(`
            *,
            work_center:work_centers(name, code)
          `)
          .eq('manufacturing_order_id', moId)
          .order('stage_number')
      
      if (error) throw error
      return data as StageCost[]
    },
  })
}

export const useCreateStageCost = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (stageCost: Omit<StageCost, 'id' | 'created_at' | 'updated_at'>) => {
      if (!supabase) throw new Error('Supabase client not initialized')
      const { data, error } = await supabase
        .from('stage_costs')
        .insert(stageCost)
        .select()
        .single()
      
      if (error) throw error
      return data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stage-costs', variables.manufacturing_order_id] })
    },
  })
}

export const useUpdateStageCost = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<StageCost> & { id: string }) => {
      if (!supabase) throw new Error('Supabase client not initialized')
      const { data, error } = await supabase
        .from('stage_costs')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      
      if (error) throw error
      return data
    },
    onSuccess: (_, ) => {
      // We don't know the MO ID here, so we invalidate all stage-costs queries
      queryClient.invalidateQueries({ queryKey: ['stage-costs'] })
    },
  })
}