/**
 * Process Costing System for Manufacturing
 * Advanced stage-based costing with transferred-in costs and AVCO integration
 */

import { createSecureRPC, validateInput } from '../../core/security.ts'
import { getSupabase, getTenantId } from '../../core/supabase.ts'
import { getTableName } from '../../core/config.ts'
import { recordFinishedGoodsProduction } from '../inventory/avco'

// Manufacturing stage definitions
export const MANUFACTURING_STAGES = {
  10: 'Rolling Stage',           // المرحلة 10: تصنيع الرول - Materials entry point
  20: 'Transparency Processing', // المرحلة 20: معالجة الشفافية
  30: 'Lid Formation',          // المرحلة 30: تشكيل الأغطية
  40: 'Container Formation',    // المرحلة 40: تشكيل العلب
  50: 'Regrind Processing'      // المرحلة 50: معالجة الهالك والإرجاع
} as const

export type StageNumber = keyof typeof MANUFACTURING_STAGES

// Cost component types
export interface CostComponents {
  transferredInCost: number      // From previous stage
  directMaterialsCost: number    // Only in stage 10
  directLaborCost: number        // All stages
  manufacturingOverheadCost: number // All stages
  regrindProcessingCost: number  // Rework/regrind costs
  wasteCreditValue: number       // Credit for saleable waste
}

// Stage cost calculation result
export interface StageCostResult extends CostComponents {
  totalCost: number
  unitCost: number
  goodQuantity: number
  scrapQuantity: number
  equivalentUnits: number
}

// Stage status types
export type StageStatus = 'planning' | 'in_progress' | 'completed' | 'closed'

// Manufacturing order stage
export interface ManufacturingStage {
  id: string
  moId: string
  stageNo: StageNumber
  workCenterId: string
  goodQty: number
  scrapQty: number
  reworkQty: number
  costs: CostComponents
  totalCost: number
  unitCost: number
  status: StageStatus
  startDate?: string
  endDate?: string
  notes?: string
}

/**
 * Process Costing Calculator
 */
export class ProcessCostingCalculator {
  private tenantId: string | null = null

  constructor() {
    this.initializeTenant()
  }

  private async initializeTenant() {
    this.tenantId = await getTenantId()
  }

  /**
   * Calculate stage costs with transferred-in logic
   */
  calculateStageCost(
    stageNo: StageNumber,
    goodQty: number,
    scrapQty: number,
    costs: Partial<CostComponents>,
    previousStageUnitCost: number = 0
  ): StageCostResult {
    // Validate inputs
    this.validateStageInputs(stageNo, goodQty, scrapQty, costs)

    const result: StageCostResult = {
      transferredInCost: 0,
      directMaterialsCost: 0,
      directLaborCost: costs.directLaborCost || 0,
      manufacturingOverheadCost: costs.manufacturingOverheadCost || 0,
      regrindProcessingCost: costs.regrindProcessingCost || 0,
      wasteCreditValue: costs.wasteCreditValue || 0,
      totalCost: 0,
      unitCost: 0,
      goodQuantity: goodQty,
      scrapQuantity: scrapQty,
      equivalentUnits: goodQty + scrapQty // Simplified equivalent units
    }

    // Calculate transferred-in cost (from previous stage)
    if (stageNo > 10 && previousStageUnitCost > 0) {
      result.transferredInCost = (goodQty + scrapQty) * previousStageUnitCost
    }

    // Direct materials only allowed in stage 10
    if (stageNo === 10) {
      result.directMaterialsCost = costs.directMaterialsCost || 0
    }

    // Calculate total cost
    result.totalCost = 
      result.transferredInCost +
      result.directMaterialsCost +
      result.directLaborCost +
      result.manufacturingOverheadCost +
      result.regrindProcessingCost -
      result.wasteCreditValue

    // Calculate unit cost (only for good units)
    if (goodQty > 0) {
      result.unitCost = result.totalCost / goodQty
    }

    return result
  }

  /**
   * Process stage completion and transfer to next stage
   */
  async processStageCompletion(
    moId: string,
    stageNo: StageNumber,
    completedQty: number,
    scrapQty: number = 0
  ): Promise<StageCostResult> {
    try {
      // Get current stage cost data
      const stageData = await this.getStageData(moId, stageNo)
      
      if (!stageData) {
        throw new Error(`Stage ${stageNo} not found for MO ${moId}`)
      }

      // Update stage with completion data
      const updateResult = await this.updateStageCost(
        moId,
        stageNo,
        stageData.workCenterId,
        completedQty,
        scrapQty
      )

      // Mark stage as completed
      await this.updateStageStatus(moId, stageNo, 'completed')

      // If this is the final stage, transfer to finished goods
      if (this.isFinalStage(stageNo)) {
        await this.transferToFinishedGoods(moId, completedQty, updateResult.unitCost)
      } else {
        // Prepare next stage with transferred-in costs
        await this.prepareNextStage(stageNo, updateResult.unitCost)
      }

      return updateResult

    } catch (error) {
      console.error(`Failed to process stage ${stageNo} completion:`, error)
      throw error
    }
  }

  /**
   * Apply labor costs to a stage
   */
  async applyLaborCost(
    moId: string,
    stageNo: StageNumber,
    hoursWorked: number,
    hourlyRate: number,
    workerName: string = ''
  ): Promise<number> {
    try {
      const applyLabor = createSecureRPC('apply_labor_time')
      
      const totalLaborCost = await applyLabor({
        p_mo_id: moId,
        p_stage_no: stageNo,
        p_hours: hoursWorked,
        p_hourly_rate: hourlyRate,
        p_worker_name: workerName
      })

      console.log(`Labor cost applied to stage ${stageNo}: ${hoursWorked}h × ${hourlyRate} = ${totalLaborCost}`)
      
      return totalLaborCost

    } catch (error) {
      console.error(`Failed to apply labor cost to stage ${stageNo}:`, error)
      throw error
    }
  }

  /**
   * Apply manufacturing overhead to a stage
   */
  async applyOverheadCost(
    moId: string,
    stageNo: StageNumber,
    baseQuantity: number,
    overheadRate: number,
    basis: 'labor_hours' | 'machine_hours' | 'labor_cost' | 'units_produced' = 'labor_hours'
  ): Promise<number> {
    try {
      const applyOverhead = createSecureRPC('apply_overhead')
      
      const totalOverheadCost = await applyOverhead({
        p_mo_id: moId,
        p_stage_no: stageNo,
        p_base_qty: baseQuantity,
        p_overhead_rate: overheadRate,
        p_basis: basis
      })

      console.log(`Overhead applied to stage ${stageNo}: ${baseQuantity} × ${overheadRate} = ${totalOverheadCost}`)
      
      return totalOverheadCost

    } catch (error) {
      console.error(`Failed to apply overhead cost to stage ${stageNo}:`, error)
      throw error
    }
  }

  /**
   * Consume BOM materials for a stage
   */
  async consumeBOMMaterials(
    moId: string,
    stageNo: StageNumber,
    productionQty: number
  ): Promise<{ totalMaterialCost: number; consumptionDetails: any[] }> {
    try {
      const consumeBOM = createSecureRPC('consume_bom_materials')
      
      const consumptionDetails = await consumeBOM({
        p_mo_id: moId,
        p_stage_no: stageNo,
        p_quantity: productionQty
      })

      const totalMaterialCost = consumptionDetails.reduce(
        (total: number, detail: any) => total + detail.total_cost, 
        0
      )

      console.log(`BOM materials consumed for stage ${stageNo}: ${totalMaterialCost}`)
      
      return { totalMaterialCost, consumptionDetails }

    } catch (error) {
      console.error(`Failed to consume BOM materials for stage ${stageNo}:`, error)
      throw error
    }
  }

  /**
   * Get complete costing summary for an MO
   */
  async getMOCostingSummary(moId: string): Promise<ManufacturingStage[]> {
    try {
      const getSummary = createSecureRPC('get_mo_stage_summary')
      
      const summary = await getSummary({
        p_mo_id: moId
      })

      return summary.map((stage: any) => ({
        id: `${moId}-${stage.stage_no}`,
        moId: moId,
        stageNo: stage.stage_no,
        workCenterId: stage.work_center_id,
        goodQty: stage.good_qty,
        scrapQty: 0, // Would need to add to RPC
        reworkQty: 0, // Would need to add to RPC
        costs: {
          transferredInCost: stage.transferred_in,
          directMaterialsCost: stage.direct_materials,
          directLaborCost: stage.direct_labor,
          manufacturingOverheadCost: stage.manufacturing_overhead,
          regrindProcessingCost: 0, // Would need to add to RPC
          wasteCreditValue: 0 // Would need to add to RPC
        },
        totalCost: stage.total_cost,
        unitCost: stage.unit_cost,
        status: stage.status as StageStatus
      }))

    } catch (error) {
      console.error(`Failed to get MO costing summary:`, error)
      throw error
    }
  }

  /**
   * Update stage cost using RPC
   */
  private async updateStageCost(
    moId: string,
    stageNo: StageNumber,
    workCenterId: string,
    goodQty: number,
    scrapQty: number = 0,
    dmCost: number = 0
  ): Promise<StageCostResult> {
    const upsertStage = createSecureRPC('upsert_stage_cost')
    
    const result = await upsertStage({
      p_mo_id: moId,
      p_stage_no: stageNo,
      p_work_center_id: workCenterId,
      p_good_qty: goodQty,
      p_scrap_qty: scrapQty,
      p_dm_cost: dmCost
    })

    return {
      transferredInCost: result.transferred_in,
      directMaterialsCost: dmCost,
      directLaborCost: 0, // Updated separately
      manufacturingOverheadCost: 0, // Updated separately
      regrindProcessingCost: 0,
      wasteCreditValue: 0,
      totalCost: result.total_cost,
      unitCost: result.unit_cost,
      goodQuantity: goodQty,
      scrapQuantity: scrapQty,
      equivalentUnits: goodQty + scrapQty
    }
  }

  /**
   * Get stage data from database
   */
  private async getStageData(moId: string, stageNo: StageNumber): Promise<any> {
    const client = await getSupabase()
    
    const { data, error } = await client
      .from(getTableName('stage_costs'))
      .select('*')
      .eq('mo_id', moId)
      .eq('stage_no', stageNo)
      .eq('tenant_id', this.tenantId)
      .single()

    if (error) {
      console.error('Failed to get stage data:', error)
      return null
    }

    return data
  }

  /**
   * Update stage status
   */
  private async updateStageStatus(moId: string, stageNo: StageNumber, status: StageStatus): Promise<void> {
    const client = await getSupabase()
    
    const { error } = await client
      .from(getTableName('stage_costs'))
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('mo_id', moId)
      .eq('stage_no', stageNo)
      .eq('tenant_id', this.tenantId)

    if (error) {
      throw new Error(`Failed to update stage status: ${error.message}`)
    }
  }

  /**
   * Check if this is the final manufacturing stage
   */
  private isFinalStage(stageNo: StageNumber): boolean {
    const stages = Object.keys(MANUFACTURING_STAGES).map(Number).sort((a, b) => b - a)
    return stageNo === stages[0] // Highest stage number
  }

  /**
   * Transfer completed production to finished goods inventory
   */
  private async transferToFinishedGoods(
    moId: string,
    completedQty: number,
    unitCost: number
  ): Promise<void> {
    // Get MO details to find the item
    const client = await getSupabase()
    
    const { data: moData, error } = await client
      .from(getTableName('manufacturing_orders'))
      .select('item_id, order_number')
      .eq('id', moId)
      .eq('tenant_id', this.tenantId)
      .single()

    if (error || !moData) {
      throw new Error('Manufacturing order not found')
    }

    // Record finished goods production in AVCO system
    await recordFinishedGoodsProduction(
      moData.item_id,
      completedQty,
      unitCost,
      moId,
      moData.order_number
    )

    console.log(`Transferred ${completedQty} units to finished goods at ${unitCost} per unit`)
  }

  /**
   * Prepare next stage with transferred-in costs
   */
  private async prepareNextStage(
    currentStageNo: StageNumber,
    unitCost: number
  ): Promise<void> {
    const stages = Object.keys(MANUFACTURING_STAGES).map(Number).sort()
    const currentIndex = stages.indexOf(currentStageNo)
    
    if (currentIndex >= 0 && currentIndex < stages.length - 1) {
      const nextStageNo = stages[currentIndex + 1] as StageNumber
      
      console.log(`Prepared stage ${nextStageNo} with transferred-in unit cost: ${unitCost}`)
      
      // The next stage will automatically pick up the transferred-in cost
      // when its costs are calculated via the RPC function
    }
  }

  /**
   * Validate stage calculation inputs
   */
  private validateStageInputs(
    stageNo: StageNumber,
    goodQty: number,
    scrapQty: number,
    costs: Partial<CostComponents>
  ): void {
    const errors: string[] = []

    if (!Object.keys(MANUFACTURING_STAGES).includes(stageNo.toString())) {
      errors.push(`Invalid stage number: ${stageNo}`)
    }

    if (!validateInput.positiveNumber(goodQty) && goodQty !== 0) {
      errors.push('Good quantity must be a non-negative number')
    }

    if (!validateInput.number(scrapQty) || scrapQty < 0) {
      errors.push('Scrap quantity must be a non-negative number')
    }

    // Validate cost components
    for (const [key, value] of Object.entries(costs)) {
      if (value !== undefined && (!validateInput.number(value) || value < 0)) {
        errors.push(`${key} must be a non-negative number`)
      }
    }

    if (errors.length > 0) {
      throw new Error(`Stage validation failed: ${errors.join(', ')}`)
    }
  }
}

// Export singleton instance
export const processCostingCalculator = new ProcessCostingCalculator()

// Utility functions for common operations

/**
 * Start new manufacturing order with initial stage setup
 */
export const startManufacturingOrder = async (
  itemId: string,
  quantity: number,
  startDate?: string,
  dueDate?: string
): Promise<{ moId: string; moNumber: string; stagesCreated: number }> => {
  const createMO = createSecureRPC('create_manufacturing_order')
  
  return await createMO({
    p_item_id: itemId,
    p_quantity: quantity,
    p_start_date: startDate,
    p_due_date: dueDate
  })
}

/**
 * Complete manufacturing order
 */
export const completeManufacturingOrder = async (
  moId: string,
  completedQty: number,
  scrapQty: number = 0
): Promise<{ finalUnitCost: number; totalCostTransferred: number; fgAvgCostAfter: number }> => {
  const completeMO = createSecureRPC('complete_manufacturing_order')
  
  return await completeMO({
    p_mo_id: moId,
    p_completed_qty: completedQty,
    p_scrap_qty: scrapQty
  })
}

export default {
  ProcessCostingCalculator,
  processCostingCalculator,
  MANUFACTURING_STAGES,
  startManufacturingOrder,
  completeManufacturingOrder
}