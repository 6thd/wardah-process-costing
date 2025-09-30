// src/hooks/useWorkCenters.ts
// React Query hooks for work centers

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, withOrgContext } from '@/lib/supabase'

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

export const useWorkCenters = () => {
  return useQuery({
    queryKey: ['work-centers'],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      const { data, error } = await withOrgContext(
        supabase.from('work_centers').select('*')
      )
      
      if (error) throw error
      return data as WorkCenter[]
    },
  })
}

export const useCreateWorkCenter = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (workCenter: Omit<WorkCenter, 'id' | 'created_at' | 'updated_at'>) => {
      if (!supabase) throw new Error('Supabase client not initialized')
      const { data, error } = await supabase
        .from('work_centers')
        .insert(workCenter)
        .select()
        .single()
      
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-centers'] })
    },
  })
}