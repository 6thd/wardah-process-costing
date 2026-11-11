/**
 * Process Costing Service
 * Handles process costing operations with support for stage_id and stage_number
 */

import { supabase as _supabase } from '@/lib/supabase'
import { StageCostingUnavailableError } from './stage-costing-availability'
const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

export interface ProcessCostingParams {
  moId: string
  stageId?: string | null  // New: UUID from manufacturing_stages
  stageNo?: number | null  // Old: Fallback for backward compatibility
  workCenterId?: string
  goodQty?: number
  scrapQty?: number
  reworkQty?: number
  directMaterialCost?: number
  laborHours?: number
  hourlyRate?: number
  overheadRate?: number
  baseQty?: number
  overheadType?: string
  employeeName?: string
  operationCode?: string
  notes?: string
  mode?: 'precosted' | 'actual' | 'completed'
}

export interface StageCostResult {
  id?: string
  manufacturing_order_id: string
  stage_id?: string
  stage_number?: number
  work_center_id?: string
  good_quantity: number
  scrap_quantity: number
  material_cost: number
  labor_cost: number
  overhead_cost: number
  total_cost: number
  unit_cost: number
  status: string
}

export interface LaborTimeResult {
  id: string
  totalLaborCost: number
  hours: number
  hourlyRate: number
}

export interface OverheadResult {
  id: string
  overheadAmount: number
  baseQty: number
  rate: number
}

// #260 interim: see ./stage-costing-availability.ts. Re-exported for existing importers of this module.
export { STAGE_COSTING_UNAVAILABLE_CODE, StageCostingUnavailableError, isStageCostingUnavailable } from './stage-costing-availability'

class ProcessCostingService {
  /**
   * Apply labor time to a stage — unavailable until #260 (see StageCostingUnavailableError).
   */
  async applyLaborTime(_params: ProcessCostingParams): Promise<{ success: boolean; data: LaborTimeResult }> {
    throw new StageCostingUnavailableError('applyLaborTime')
  }

  /**
   * Apply overhead to a stage — unavailable until #260 (see StageCostingUnavailableError).
   */
  async applyOverhead(_params: ProcessCostingParams): Promise<{ success: boolean; data: OverheadResult }> {
    throw new StageCostingUnavailableError('applyOverhead')
  }

  /**
   * Upsert stage cost — unavailable until #260 (see StageCostingUnavailableError).
   */
  async upsertStageCost(_params: ProcessCostingParams): Promise<{ success: boolean; data: StageCostResult }> {
    throw new StageCostingUnavailableError('upsertStageCost')
  }

  /**
   * Get stage costs for a manufacturing order
   */
  async getStageCosts(moId: string): Promise<{ success: boolean; data: StageCostResult[] }> {
    try {
      if (!moId) {
        throw new Error('Missing required parameter: moId')
      }

      const { data, error } = await supabase
        .from('stage_costs')
        .select('*')
        .eq('manufacturing_order_id', moId)
        .order('stage_number', { ascending: true })

      if (error) {
        throw new Error(`فشل جلب تكاليف المراحل: ${error.message}`)
      }

      return {
        success: true,
        data: (data || []) as StageCostResult[]
      }
    } catch (error: any) {
      console.error('Error getting stage costs:', error)
      throw error
    }
  }
}

export const processCostingService = new ProcessCostingService()

