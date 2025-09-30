/**
 * Equivalent Units Calculation Service
 * Advanced process costing with equivalent units methodology
 */

import { createSecureRPC } from '@/core/security.ts'
import { getSupabase, getTenantId } from '@/core/supabase'
import { getTableName } from '@/lib/config'
import { PostingService } from '@/services/accounting/posting-service'
import { NotificationService } from '@/services/accounting/notification-service'

// Equivalent Units interface
export interface EquivalentUnits {
  id?: string
  moId: string
  stageNo: number
  calculationDate: string
  beginningWipUnits: number
  unitsStarted: number
  unitsCompleted: number
  endingWipUnits: number
  materialCompletionPercentage: number
  conversionCompletionPercentage: number
  equivalentUnitsMaterial: number
  equivalentUnitsConversion: number
  tenantId?: string
}

// Cost Per Equivalent Unit interface
export interface CostPerEquivalentUnit {
  id?: string
  moId: string
  stageNo: number
  calculationPeriodStart: string
  calculationPeriodEnd: string
  materialCost: number
  laborCost: number
  overheadCost: number
  totalCost: number
  equivalentUnitsMaterial: number
  equivalentUnitsConversion: number
  costPerEquivalentUnitMaterial: number
  costPerEquivalentUnitConversion: number
  tenantId?: string
}

// Variance Analysis interface (updated to match notification service)
export interface VarianceAnalysis {
  id?: string
  moId: string
  stageNo: number
  varianceDate: string
  standardMaterialCost: number
  standardLaborCost: number
  standardOverheadCost: number
  actualMaterialCost: number
  actualLaborCost: number
  actualOverheadCost: number
  materialCostVariance: number
  laborCostVariance: number
  overheadCostVariance: number
  totalVariance: number
  materialVariancePercentage: number
  laborVariancePercentage: number
  overheadVariancePercentage: number
  varianceSeverity: 'LOW' | 'MEDIUM' | 'HIGH'
  tenantId?: string
  // Additional properties for notification service
  materialVariance?: number
  laborVariance?: number
  overheadVariance?: number
  variancePercentage?: number
  severity?: 'LOW' | 'MEDIUM' | 'HIGH'
}

// Production Batch interface
export interface ProductionBatch {
  id?: string
  batchNumber: string
  productId: string
  startDate: string
  targetCompletionDate?: string
  actualCompletionDate?: string
  plannedQuantity: number
  actualQuantity?: number
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  priorityLevel: number
  tenantId?: string
}

/**
 * Equivalent Units Service
 */
export class EquivalentUnitsService {
  private tenantId: string | null = null

  constructor() {
    this.initializeTenant()
  }

  private async initializeTenant() {
    this.tenantId = await getTenantId()
  }

  /**
   * Calculate equivalent units for a manufacturing stage
   */
  async calculateEquivalentUnits(
    moId: string,
    stageNo: number,
    beginningWip: number = 0,
    unitsStarted: number = 0,
    unitsCompleted: number = 0,
    endingWip: number = 0,
    materialCompletionPct: number = 100,
    conversionCompletionPct: number = 100
  ): Promise<{ equivalentUnitsMaterial: number; equivalentUnitsConversion: number }> {
    try {
      const calculateEU = createSecureRPC('calculate_equivalent_units')
      
      const result = await calculateEU({
        p_mo_id: moId,
        p_stage: stageNo,
        p_beginning_wip: beginningWip,
        p_units_started: unitsStarted,
        p_units_completed: unitsCompleted,
        p_ending_wip: endingWip,
        p_material_completion_pct: materialCompletionPct,
        p_conversion_completion_pct: conversionCompletionPct
      })

      return {
        equivalentUnitsMaterial: result.equivalent_units_material,
        equivalentUnitsConversion: result.equivalent_units_conversion
      }
    } catch (error) {
      console.error('Failed to calculate equivalent units:', error)
      throw error
    }
  }

  /**
   * Calculate cost per equivalent unit for a period
   */
  async calculateCostPerEquivalentUnit(
    moId: string,
    stageNo: number,
    periodStart: string,
    periodEnd: string
  ): Promise<CostPerEquivalentUnit> {
    try {
      const calculateCPEU = createSecureRPC('calculate_cost_per_equivalent_unit')
      
      const result = await calculateCPEU({
        p_mo_id: moId,
        p_stage: stageNo,
        p_period_start: periodStart,
        p_period_end: periodEnd
      })

      return {
        moId,
        stageNo,
        calculationPeriodStart: periodStart,
        calculationPeriodEnd: periodEnd,
        materialCost: result.material_cost,
        laborCost: result.labor_cost,
        overheadCost: result.overhead_cost,
        totalCost: result.total_cost,
        equivalentUnitsMaterial: result.equivalent_units_material,
        equivalentUnitsConversion: result.equivalent_units_conversion,
        costPerEquivalentUnitMaterial: result.cost_per_equivalent_unit_material,
        costPerEquivalentUnitConversion: result.cost_per_equivalent_unit_conversion
      }
    } catch (error) {
      console.error('Failed to calculate cost per equivalent unit:', error)
      throw error
    }
  }

  /**
   * Perform variance analysis and post to GL if significant
   */
  async performVarianceAnalysis(
    moId: string,
    stageNo: number
  ): Promise<VarianceAnalysis> {
    try {
      const performVariance = createSecureRPC('perform_variance_analysis')
      
      const result = await performVariance({
        p_mo_id: moId,
        p_stage: stageNo
      })

      const varianceAnalysis: VarianceAnalysis = {
        moId,
        stageNo,
        varianceDate: new Date().toISOString(),
        standardMaterialCost: result.standard_material_cost,
        standardLaborCost: result.standard_labor_cost,
        standardOverheadCost: result.standard_overhead_cost,
        actualMaterialCost: result.actual_material_cost,
        actualLaborCost: result.actual_labor_cost,
        actualOverheadCost: result.actual_overhead_cost,
        materialCostVariance: result.material_cost_variance,
        laborCostVariance: result.labor_cost_variance,
        overheadCostVariance: result.overhead_cost_variance,
        totalVariance: result.total_variance,
        materialVariancePercentage: result.material_variance_percentage,
        laborVariancePercentage: result.labor_variance_percentage,
        overheadVariancePercentage: result.overhead_variance_percentage,
        varianceSeverity: result.variance_severity as 'LOW' | 'MEDIUM' | 'HIGH',
        // Additional properties for notification service
        materialVariance: result.material_cost_variance,
        laborVariance: result.labor_cost_variance,
        overheadVariance: result.overhead_cost_variance,
        variancePercentage: result.total_variance,
        severity: result.variance_severity as 'LOW' | 'MEDIUM' | 'HIGH'
      }

      // If variance is significant, post to GL and send notifications
      if (Math.abs(varianceAnalysis.totalVariance) > 1000 || varianceAnalysis.varianceSeverity === 'HIGH') {
        try {
          // Post to GL
          const journalId = await PostingService.postEventJournal({
            event: 'PROCESS_COST_VARIANCE',
            amount: Math.abs(varianceAnalysis.totalVariance),
            memo: `Variance analysis for MO ${moId} Stage ${stageNo}: ${varianceAnalysis.totalVariance}`,
            refType: 'VARIANCE_ANALYSIS',
            refId: `${moId}-${stageNo}`,
            idempotencyKey: `VAR_${moId}_${stageNo}_${Date.now()}`
          })

          console.log(`Posted variance journal entry: ${journalId}`)
        } catch (error) {
          console.error('Failed to post variance to GL:', error)
        }

        // Send notifications (in a real implementation, you would get user ID from context)
        // For now, we'll use a placeholder
        try {
          const userId = 'current-user-id' // This would come from auth context
          const preferences = await NotificationService.getNotificationPreferences(userId)
          
          if (preferences.severityThreshold === 'LOW' || 
              (preferences.severityThreshold === 'MEDIUM' && varianceAnalysis.varianceSeverity !== 'LOW') ||
              (preferences.severityThreshold === 'HIGH' && varianceAnalysis.varianceSeverity === 'HIGH')) {
            
            // Create a compatible variance analysis object for the notification service
            const notificationVariance = {
              moId: varianceAnalysis.moId,
              stageNo: varianceAnalysis.stageNo,
              materialVariance: varianceAnalysis.materialVariance || 0,
              laborVariance: varianceAnalysis.laborVariance || 0,
              overheadVariance: varianceAnalysis.overheadVariance || 0,
              totalVariance: varianceAnalysis.totalVariance,
              variancePercentage: varianceAnalysis.variancePercentage || 0,
              severity: varianceAnalysis.severity || varianceAnalysis.varianceSeverity
            };
            
            await NotificationService.sendVarianceAlert(userId, notificationVariance, preferences)
          }
        } catch (error) {
          console.error('Failed to send variance notification:', error)
        }
      }

      return varianceAnalysis
    } catch (error) {
      console.error('Failed to perform variance analysis:', error)
      throw error
    }
  }

  /**
   * Get latest equivalent units calculation
   */
  async getLatestEquivalentUnits(
    moId: string,
    stageNo: number
  ): Promise<EquivalentUnits | null> {
    try {
      const getLatestEU = createSecureRPC('get_equivalent_units_latest')
      
      const result = await getLatestEU({
        p_mo_id: moId,
        p_stage: stageNo
      })

      if (!result) return null

      return {
        moId,
        stageNo,
        calculationDate: result.calculation_date,
        beginningWipUnits: 0, // Would need to fetch from DB
        unitsStarted: 0, // Would need to fetch from DB
        unitsCompleted: 0, // Would need to fetch from DB
        endingWipUnits: 0, // Would need to fetch from DB
        materialCompletionPercentage: 0, // Would need to fetch from DB
        conversionCompletionPercentage: 0, // Would need to fetch from DB
        equivalentUnitsMaterial: result.equivalent_units_material,
        equivalentUnitsConversion: result.equivalent_units_conversion
      }
    } catch (error) {
      console.error('Failed to get latest equivalent units:', error)
      throw error
    }
  }

  /**
   * Get latest cost per equivalent unit calculation
   */
  async getLatestCostPerEquivalentUnit(
    moId: string,
    stageNo: number
  ): Promise<CostPerEquivalentUnit | null> {
    try {
      const getLatestCPEU = createSecureRPC('get_cost_per_equivalent_unit_latest')
      
      const result = await getLatestCPEU({
        p_mo_id: moId,
        p_stage: stageNo
      })

      if (!result) return null

      return {
        moId,
        stageNo,
        calculationPeriodStart: result.calculation_period_start,
        calculationPeriodEnd: result.calculation_period_end,
        materialCost: 0, // Would need to fetch from DB
        laborCost: 0, // Would need to fetch from DB
        overheadCost: 0, // Would need to fetch from DB
        totalCost: 0, // Would need to fetch from DB
        equivalentUnitsMaterial: 0, // Would need to fetch from DB
        equivalentUnitsConversion: 0, // Would need to fetch from DB
        costPerEquivalentUnitMaterial: result.cost_per_equivalent_unit_material,
        costPerEquivalentUnitConversion: result.cost_per_equivalent_unit_conversion
      }
    } catch (error) {
      console.error('Failed to get latest cost per equivalent unit:', error)
      throw error
    }
  }

  /**
   * Get variance analysis alerts
   */
  async getVarianceAlerts(
    severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'
  ): Promise<VarianceAnalysis[]> {
    try {
      const getAlerts = createSecureRPC('get_variance_analysis_alerts')
      
      const results = await getAlerts({
        p_severity: severity
      })

      return results.map((result: any) => ({
        moId: result.mo_id,
        stageNo: result.stage_no,
        varianceDate: result.variance_date,
        standardMaterialCost: 0, // Would need to fetch from DB
        standardLaborCost: 0, // Would need to fetch from DB
        standardOverheadCost: 0, // Would need to fetch from DB
        actualMaterialCost: 0, // Would need to fetch from DB
        actualLaborCost: 0, // Would need to fetch from DB
        actualOverheadCost: 0, // Would need to fetch from DB
        materialCostVariance: 0, // Would need to fetch from DB
        laborCostVariance: 0, // Would need to fetch from DB
        overheadCostVariance: 0, // Would need to fetch from DB
        totalVariance: result.total_variance,
        materialVariancePercentage: result.material_variance_percentage,
        laborVariancePercentage: result.labor_variance_percentage,
        overheadVariancePercentage: result.overhead_variance_percentage,
        varianceSeverity: result.variance_severity as 'LOW' | 'MEDIUM' | 'HIGH'
      }))
    } catch (error) {
      console.error('Failed to get variance alerts:', error)
      throw error
    }
  }

  /**
   * Create a production batch
   */
  async createProductionBatch(batch: Omit<ProductionBatch, 'id' | 'tenantId'>): Promise<ProductionBatch> {
    try {
      const client = await getSupabase()
      
      const { data, error } = await client
        .from(getTableName('production_batches'))
        .insert([{
          ...batch,
          tenant_id: this.tenantId
        }])
        .select()
        .single()

      if (error) throw error

      return {
        id: data.id,
        batchNumber: data.batch_number,
        productId: data.product_id,
        startDate: data.start_date,
        targetCompletionDate: data.target_completion_date,
        actualCompletionDate: data.actual_completion_date,
        plannedQuantity: data.planned_quantity,
        actualQuantity: data.actual_quantity,
        status: data.status,
        priorityLevel: data.priority_level,
        tenantId: data.tenant_id
      }
    } catch (error) {
      console.error('Failed to create production batch:', error)
      throw error
    }
  }

  /**
   * Get production batches
   */
  async getProductionBatches(status?: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'): Promise<ProductionBatch[]> {
    try {
      const client = await getSupabase()
      
      let query = client
        .from(getTableName('production_batches'))
        .select('*')
        .eq('tenant_id', this.tenantId)

      if (status) {
        query = query.eq('status', status)
      }

      const { data, error } = await query

      if (error) throw error

      return data.map(item => ({
        id: item.id,
        batchNumber: item.batch_number,
        productId: item.product_id,
        startDate: item.start_date,
        targetCompletionDate: item.target_completion_date,
        actualCompletionDate: item.actual_completion_date,
        plannedQuantity: item.planned_quantity,
        actualQuantity: item.actual_quantity,
        status: item.status,
        priorityLevel: item.priority_level,
        tenantId: item.tenant_id
      }))
    } catch (error) {
      console.error('Failed to get production batches:', error)
      throw error
    }
  }

  /**
   * Update production batch status
   */
  async updateBatchStatus(batchId: string, status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'): Promise<void> {
    try {
      const client = await getSupabase()
      
      const { error } = await client
        .from(getTableName('production_batches'))
        .update({ 
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', batchId)
        .eq('tenant_id', this.tenantId)

      if (error) throw error
    } catch (error) {
      console.error('Failed to update batch status:', error)
      throw error
    }
  }
}

// Export singleton instance
export const equivalentUnitsService = new EquivalentUnitsService()

export default {
  EquivalentUnitsService,
  equivalentUnitsService
}