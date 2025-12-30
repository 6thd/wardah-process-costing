// src/hooks/useWorkCenters.ts
// React Query hooks for work centers

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { loadConfig } from '@/lib/config'
import type { WorkCenter } from '@/types/work-center'

export type { WorkCenter }

export const useWorkCenters = () => {
  return useQuery({
    queryKey: ['work-centers'],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized')
      try {
        // Get current organization ID from config
        const config = await loadConfig()
        const orgId = config.ORG_ID

        let query = supabase
          .from('work_centers')
          .select('*')
          .order('name')

        // Filter by organization ID if available
        if (orgId) {
          query = query.eq('org_id', orgId)
        }
        
        const { data, error } = await query
        
        // Handle missing table gracefully
        if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
          console.warn('work_centers table not found, returning empty array')
          return [] as WorkCenter[]
        }
        
        if (error) throw error
        return (data || []) as WorkCenter[]
      } catch (error: unknown) {
        // If table doesn't exist, return empty array
        if (
          (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'PGRST205') ||
          (error && typeof error === 'object' && 'message' in error && typeof (error as { message: string }).message === 'string' && (error as { message: string }).message.includes('Could not find the table'))
        ) {
          console.warn('work_centers table not found, returning empty array')
          return [] as WorkCenter[]
        }
        throw error
      }
    },
    // Performance optimization: Cache for 10 minutes (work centers change rarely)
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
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