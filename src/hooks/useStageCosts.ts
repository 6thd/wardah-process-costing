// src/hooks/useStageCosts.ts
// React Query hooks for stage costs

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PerformanceMonitor } from '@/lib/performance-monitor'
import type { WorkCenter } from '@/types/work-center'

export interface StageCost {
  id: string
  org_id: string
  manufacturing_order_id: string
  stage_id?: string  // New: UUID from manufacturing_stages
  stage_number?: number  // Old: Fallback for backward compatibility
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
      return PerformanceMonitor.measure('Stage Costs Fetch', async () => {
        if (!supabase) throw new Error('Supabase client not initialized')
        if (!moId) return [] as StageCost[]

        try {
          // Try with mo_id first (old schema - most likely)
          let { data, error } = await supabase.from('stage_costs')
            .select('*')
            .eq('mo_id', moId)
          
          // If that fails, try with manufacturing_order_id (new schema)
          if (error && (error.code === '42703' || error.message?.includes('mo_id') || error.code === '400')) {
            console.debug('Trying with manufacturing_order_id instead of mo_id')
            const result = await supabase.from('stage_costs')
              .select('*')
              .eq('manufacturing_order_id', moId)
            
            data = result.data
            error = result.error
          }
          
          // If we have data, enrich with work_center and manufacturing_stage
          if (data && !error && data.length > 0) {
            // Get unique work center IDs
            const workCenterIds = [...new Set(data.map((item: any) => item.wc_id || item.work_center_id).filter(Boolean))]
            const stageIds = [...new Set(data.map((item: any) => item.stage_id).filter(Boolean))]
            
            // Fetch work centers
            let workCenters: any[] = []
            if (workCenterIds.length > 0) {
              const { data: wcData } = await supabase
                .from('work_centers')
                .select('id, name, code')
                .in('id', workCenterIds)
              workCenters = wcData || []
            }
            
            // Fetch manufacturing stages
            let stages: any[] = []
            if (stageIds.length > 0) {
              const { data: stageData } = await supabase
                .from('manufacturing_stages')
                .select('*')
                .in('id', stageIds)
              stages = stageData || []
            }
            
            // Map relationships
            const wcMap = new Map(workCenters.map((wc: any) => [wc.id, wc]))
            const stageMap = new Map(stages.map((s: any) => [s.id, s]))
            
            data = data.map((item: any) => ({
              ...item,
              work_center: item.wc_id ? wcMap.get(item.wc_id) : (item.work_center_id ? wcMap.get(item.work_center_id) : null),
              manufacturing_stage: item.stage_id ? stageMap.get(item.stage_id) : null
            }))
          }
          
          // Sort in memory if needed (more reliable than database order)
          const sortedData = data ? [...data].sort((a: any, b: any) => {
            const aStage = a.stage_number || a.stage_no || 0
            const bStage = b.stage_number || b.stage_no || 0
            return aStage - bStage
          }) : null

          // Handle missing table gracefully
          if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
            console.warn('stage_costs table not found, returning empty array')
            return [] as StageCost[]
          }

          if (error) {
            console.error('Error fetching stage costs:', error)
            throw error
          }
          return (sortedData || []) as StageCost[]
        } catch (error: any) {
          // If table doesn't exist, return empty array
          if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
            console.warn('stage_costs table not found, returning empty array')
            return [] as StageCost[]
          }
          throw error
        }
      })
    },
    enabled: !!moId
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
    onSuccess: (_,) => {
      // We don't know the MO ID here, so we invalidate all stage-costs queries
      queryClient.invalidateQueries({ queryKey: ['stage-costs'] })
    },
  })
}