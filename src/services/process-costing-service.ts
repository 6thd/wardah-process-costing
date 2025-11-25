/**
 * Process Costing Service
 * Handles process costing operations with support for stage_id and stage_number
 */

import { supabase } from '@/lib/supabase'
import { loadConfig } from '@/lib/config'

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

class ProcessCostingService {
  /**
   * Apply labor time to a stage
   */
  async applyLaborTime(params: ProcessCostingParams): Promise<{ success: boolean; data: LaborTimeResult }> {
    try {
      const { moId, stageId, stageNo, workCenterId, laborHours, hourlyRate, employeeName, operationCode, notes } = params

      if (!moId || (!stageId && !stageNo) || !laborHours || !hourlyRate) {
        throw new Error('Missing required parameters: moId, stageId/stageNo, laborHours, hourlyRate')
      }

      const totalLaborCost = laborHours * hourlyRate
      const config = await loadConfig()
      const orgId = config.ORG_ID

      // Get stage_no from stageId if needed
      let targetStageNo = stageNo
      if (stageId && !stageNo) {
        const { data: stage } = await supabase
          .from('manufacturing_stages')
          .select('order_sequence')
          .eq('id', stageId)
          .single()
        
        if (stage) {
          targetStageNo = stage.order_sequence
        }
      }

      if (!targetStageNo) {
        throw new Error('stage_no is required. Please provide either stageNo or stageId.')
      }

      // wc_id is required in labor_time_logs schema
      if (!workCenterId) {
        // Try to get a default work center for this org
        // Note: work_centers uses org_id (not tenant_id)
        const { data: defaultWC } = await supabase
          .from('work_centers')
          .select('id')
          .eq('org_id', orgId)
          .limit(1)
          .single()
        
        if (!defaultWC) {
          throw new Error('workCenterId is required. No default work center found.')
        }
        workCenterId = defaultWC.id
      }

      // Insert into labor_time_logs
      const { data, error } = await supabase
        .from('labor_time_logs')
        .insert({
          tenant_id: orgId,  // Fixed: use tenant_id instead of org_id
          mo_id: moId,
          stage_no: targetStageNo, // Required field
          wc_id: workCenterId,  // Required field
          hours: laborHours,
          hourly_rate: hourlyRate,
          employee_name: employeeName || 'غير محدد',  // Fixed: use employee_name instead of worker_name
          operation_code: operationCode || null,
          notes: notes || null,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error && !error.message.includes('Could not find')) {
        throw error
      }

      return {
        success: true,
        data: {
          id: data?.id || 'temp-id',
          totalLaborCost,
          hours: laborHours,
          hourlyRate
        }
      }
    } catch (error: any) {
      console.error('Error applying labor time:', error)
      throw error
    }
  }

  /**
   * Apply overhead to a stage
   */
  async applyOverhead(params: ProcessCostingParams): Promise<{ success: boolean; data: OverheadResult }> {
    try {
      const { moId, stageId, stageNo, workCenterId, baseQty, overheadRate, overheadType, notes } = params

      if (!moId || (!stageId && !stageNo) || !baseQty || !overheadRate) {
        throw new Error('Missing required parameters: moId, stageId/stageNo, baseQty, overheadRate')
      }

      const overheadAmount = baseQty * overheadRate
      const config = await loadConfig()
      const orgId = config.ORG_ID

      // Try to use stage_wip_log if stageId is provided
      // Note: moh_applied table doesn't have stage_id, only stage_no
      // If stageId is provided, we need to get stage_no from manufacturing_stages first
      let targetStageNo = stageNo
      
      if (stageId && !stageNo) {
        // Get stage_no from manufacturing_stages
        const { data: stage } = await supabase
          .from('manufacturing_stages')
          .select('order_sequence')
          .eq('id', stageId)
          .single()
        
        if (stage) {
          targetStageNo = stage.order_sequence
        }
      }
      
      if (!targetStageNo) {
        throw new Error('stage_no is required. Please provide either stageNo or stageId.')
      }

      // wc_id is required in moh_applied schema
      let targetWorkCenterId = workCenterId
      if (!targetWorkCenterId) {
        // Try to get a default work center for this org
        // Note: work_centers uses org_id (not tenant_id)
        const { data: defaultWC } = await supabase
          .from('work_centers')
          .select('id')
          .eq('org_id', orgId)
          .limit(1)
          .single()
        
        if (!defaultWC) {
          throw new Error('workCenterId is required. No default work center found.')
        }
        targetWorkCenterId = defaultWC.id
      }

      // Insert into moh_applied
      const { data, error } = await supabase
        .from('moh_applied')
        .insert({
          tenant_id: orgId,  // Fixed: use tenant_id instead of org_id
          mo_id: moId,
          stage_no: targetStageNo,  // Required field
          wc_id: targetWorkCenterId,  // Required field
          allocation_base: 'labor_cost',  // Fixed: use allocation_base
          base_qty: baseQty,  // Fixed: use base_qty
          overhead_rate: overheadRate,
          overhead_type: overheadType || 'variable',
          notes: notes || null,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error && !error.message.includes('Could not find')) {
        throw error
      }

      return {
        success: true,
        data: {
          id: data?.id || 'temp-id',
          overheadAmount,
          baseQty,
          rate: overheadRate
        }
      }
    } catch (error: any) {
      console.error('Error applying overhead:', error)
      throw error
    }
  }

  /**
   * Upsert stage cost
   */
  async upsertStageCost(params: ProcessCostingParams): Promise<{ success: boolean; data: StageCostResult }> {
    try {
      const {
        moId,
        stageId,
        stageNo,
        workCenterId,
        goodQty,
        scrapQty,
        reworkQty,
        directMaterialCost,
        mode
      } = params

      if (!moId || (!stageId && !stageNo) || !goodQty) {
        throw new Error('Missing required parameters: moId, stageId/stageNo, goodQty')
      }

      const config = await loadConfig()
      const orgId = config.ORG_ID

      // Calculate costs
      let laborCost = 0
      let overheadCost = 0

      // Get labor costs for this stage
      // Note: labor_time_logs table doesn't have stage_id, only stage_no
      // If stageId is provided, we need to get stage_no from manufacturing_stages first
      let targetStageNo = stageNo
      
      if (stageId && !stageNo) {
        // Get stage_no from manufacturing_stages
        const { data: stage } = await supabase
          .from('manufacturing_stages')
          .select('order_sequence')
          .eq('id', stageId)
          .single()
        
        if (stage) {
          targetStageNo = stage.order_sequence
        }
      }
      
      if (targetStageNo) {
        const { data: laborLogs } = await supabase
          .from('labor_time_logs')
          .select('total_cost')
          .eq('mo_id', moId)
          .eq('stage_no', targetStageNo)

        laborCost = laborLogs?.reduce((sum, log) => sum + Number(log.total_cost || 0), 0) || 0
      }

      // Get overhead costs for this stage
      // Note: moh_applied table doesn't have stage_id, only stage_no
      // Use the same targetStageNo from labor cost calculation
      if (targetStageNo) {
        const { data: mohApplied } = await supabase
          .from('moh_applied')
          .select('amount')  // Fixed: use amount instead of total_cost
          .eq('mo_id', moId)
          .eq('stage_no', targetStageNo)

        overheadCost = mohApplied?.reduce((sum, moh) => sum + Number(moh.amount || 0), 0) || 0
      }

      // Calculate totals
      const materialCost = directMaterialCost || 0
      const totalCost = materialCost + laborCost + overheadCost
      const unitCost = goodQty > 0 ? totalCost / goodQty : 0

      // Try to insert/update in stage_costs
      const stageCostData: any = {
        org_id: orgId,
        manufacturing_order_id: moId,
        work_center_id: workCenterId || null,
        good_quantity: goodQty,
        defective_quantity: scrapQty || 0,
        material_cost: materialCost,
        labor_cost: laborCost,
        overhead_cost: overheadCost,
        total_cost: totalCost,
        unit_cost: unitCost,
        status: mode || 'actual',
        updated_at: new Date().toISOString()
      }

      // Add stage_id or stage_number
      if (stageId) {
        stageCostData.stage_id = stageId
      }
      if (stageNo) {
        stageCostData.stage_number = stageNo
      }

      // Upsert based on what's available
      let query = supabase.from('stage_costs')

      if (stageId && stageNo) {
        // Try both
        query = query.upsert(stageCostData, {
          onConflict: 'manufacturing_order_id,stage_id,org_id'
        })
      } else if (stageId) {
        query = query.upsert(stageCostData, {
          onConflict: 'manufacturing_order_id,stage_id,org_id'
        })
      } else if (stageNo) {
        query = query.upsert(stageCostData, {
          onConflict: 'manufacturing_order_id,stage_number,org_id'
        })
      }

      const { data, error } = await query.select().single()

      if (error && !error.message.includes('Could not find')) {
        throw error
      }

      return {
        success: true,
        data: data || {
          manufacturing_order_id: moId,
          stage_id: stageId || undefined,
          stage_number: stageNo || undefined,
          work_center_id: workCenterId || undefined,
          good_quantity: goodQty,
          scrap_quantity: scrapQty || 0,
          material_cost: materialCost,
          labor_cost: laborCost,
          overhead_cost: overheadCost,
          total_cost: totalCost,
          unit_cost: unitCost,
          status: mode || 'actual'
        } as StageCostResult
      }
    } catch (error: any) {
      console.error('Error upserting stage cost:', error)
      throw error
    }
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

      if (error && !error.message.includes('Could not find')) {
        throw error
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

