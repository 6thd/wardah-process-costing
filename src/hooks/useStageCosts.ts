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
  manufacturing_stage?: {
    id: string
    name: string
    name_ar?: string
  }
}

export const useStageCosts = (moId: string) => {
  return useQuery({
    queryKey: ['stage-costs', moId],
    queryFn: async () => {
      return PerformanceMonitor.measure('Stage Costs Fetch', async () => {
        if (!supabase) throw new Error('Supabase client not initialized')
        if (!moId) return [] as StageCost[]

        try {
          // Based on schema check: table uses manufacturing_order_id (not mo_id)
          // Try manufacturing_order_id first (this is the actual column name)
          let { data, error } = await supabase.from('stage_costs')
            .select('*')
            .eq('manufacturing_order_id', moId)
          
          // If that fails, try mo_id as fallback (for backward compatibility)
          if (error && (
            error.code === '42703' || 
            error.code === 'PGRST116' ||
            error.code === '400' ||
            error.message?.includes('manufacturing_order_id') ||
            error.message?.includes('column') ||
            error.message?.includes('does not exist')
          )) {
            // Debug: manufacturing_order_id failed, trying mo_id
            const result = await supabase.from('stage_costs')
              .select('*')
              .eq('mo_id', moId)
            
            data = result.data
            error = result.error
          }
          
          // If still error, try without filter (RLS will handle it)
          if (error && error.code === '400') {
            // Debug: Trying without filter, using RLS only
            const rlsResult = await supabase.from('stage_costs')
              .select('*')
              .limit(100) // Get all accessible records, filter in memory
            
            if (rlsResult.data && !rlsResult.error) {
              // Filter in memory by manufacturing_order_id or mo_id
              data = rlsResult.data.filter((item: any) => 
                item.manufacturing_order_id === moId || item.mo_id === moId
              )
              error = null
            } else {
              data = rlsResult.data
              error = rlsResult.error
            }
          }
          
          // If we have data, enrich with work_center and manufacturing_stage
          if (data && !error && data.length > 0) {
            // Get unique work center IDs (table uses work_center_id, not wc_id)
            const workCenterIds = [...new Set(data.map((item: any) => item.work_center_id || item.wc_id).filter(Boolean))]
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
              // Map work center (table uses work_center_id, not wc_id)
              work_center: item.work_center_id ? wcMap.get(item.work_center_id) : (item.wc_id ? wcMap.get(item.wc_id) : null),
              manufacturing_stage: item.stage_id ? stageMap.get(item.stage_id) : null,
              // Normalize column names for consistency
              manufacturing_order_id: item.manufacturing_order_id || item.mo_id,
              work_center_id: item.work_center_id || item.wc_id
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

          // Handle 400 Bad Request - likely RLS or column issue
          if (error && error.code === '400') {
            console.warn('400 Bad Request when fetching stage_costs:', error.message)
            // Try to get error details
            if (error.message?.includes('RLS') || error.message?.includes('policy')) {
              console.warn('RLS policy may be blocking access. Check RLS policies on stage_costs table.')
            }
            // Return empty array instead of throwing to prevent UI errors
            return [] as StageCost[]
          }

          if (error) {
            console.error('Error fetching stage costs:', error)
            // For other errors, also return empty array to prevent UI breakage
            return [] as StageCost[]
          }
          return (sortedData || []) as StageCost[]
        } catch (error: any) {
          // If table doesn't exist, return empty array
          if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
            console.warn('stage_costs table not found, returning empty array')
            return [] as StageCost[]
          }
          // For 400 errors, return empty array instead of throwing
          if (error.code === '400') {
            console.warn('400 Bad Request when fetching stage_costs:', error.message)
            return [] as StageCost[]
          }
          // Log other errors but don't break the UI
          console.error('Unexpected error fetching stage costs:', error)
          return [] as StageCost[]
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