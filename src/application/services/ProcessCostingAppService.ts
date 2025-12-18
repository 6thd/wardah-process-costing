/**
 * ProcessCostingAppService - Application Layer
 * 
 * Application service that orchestrates process costing operations.
 * Implements IProcessCostingService interface.
 * 
 * Clean Architecture:
 * - Uses repository interfaces (not implementations)
 * - Contains application logic (orchestration)
 * - Domain logic stays in domain entities
 */

import type {
  IProcessCostingService,
  ProcessCostingParams,
  StageCostResult,
  LaborTimeResult,
  OverheadResult,
  ManufacturingOrderCostSummary,
  OperationResult
} from '@/domain/interfaces/IProcessCostingService';

import type {
  IProcessCostingRepository,
  DirectMaterialData,
  DirectLaborData,
  OverheadCostData
} from '@/domain/interfaces/IProcessCostingRepository';

/**
 * Extended repository interface for stage operations
 */
export interface IProcessCostingRepositoryExtended extends IProcessCostingRepository {
  /** Get stage number from stage ID */
  getStageNumber(stageId: string): Promise<number | null>;
  /** Get default work center for organization */
  getDefaultWorkCenter(orgId: string): Promise<string | null>;
  /** Insert labor time log */
  insertLaborTimeLog(data: {
    orgId: string;
    moId: string;
    stageNo: number;
    workCenterId: string;
    hours: number;
    hourlyRate: number;
    employeeName?: string;
    operationCode?: string;
    notes?: string;
  }): Promise<{ id: string } | null>;
  /** Insert overhead applied record */
  insertOverheadApplied(data: {
    orgId: string;
    moId: string;
    stageNo: number;
    workCenterId: string;
    baseQty: number;
    overheadRate: number;
    overheadType?: string;
    notes?: string;
  }): Promise<{ id: string } | null>;
  /** Get labor costs for a stage */
  getLaborCostsByStage(moId: string, stageNo: number): Promise<number>;
  /** Get overhead costs for a stage */
  getOverheadCostsByStage(moId: string, stageNo: number): Promise<number>;
  /** Upsert stage cost record */
  upsertStageCostRecord(data: {
    orgId: string;
    moId: string;
    stageId?: string;
    stageNo?: number;
    workCenterId?: string;
    goodQty: number;
    scrapQty: number;
    materialCost: number;
    laborCost: number;
    overheadCost: number;
    totalCost: number;
    unitCost: number;
    status: string;
  }): Promise<StageCostResult | null>;
  /** Get all stage costs for a manufacturing order */
  getStageCostsByMO(moId: string): Promise<StageCostResult[]>;
  /** Get manufacturing order details */
  getManufacturingOrderDetails(moId: string): Promise<{
    orderNumber: string;
    productName: string;
    plannedQty: number;
    completedQty: number;
    standardCost?: number;
  } | null>;
}

/**
 * ProcessCostingAppService
 * 
 * Orchestrates process costing operations between domain and infrastructure layers.
 */
export class ProcessCostingAppService implements IProcessCostingService {
  constructor(
    private readonly repository: IProcessCostingRepositoryExtended,
    private readonly getOrgId: () => Promise<string>
  ) {}

  /**
   * Apply labor time to a manufacturing stage
   */
  async applyLaborTime(params: ProcessCostingParams): Promise<OperationResult<LaborTimeResult>> {
    try {
      const { moId, stageId, stageNo, workCenterId, laborHours, hourlyRate, employeeName, operationCode, notes } = params;

      // Validation
      if (!moId || (!stageId && !stageNo) || !laborHours || !hourlyRate) {
        return {
          success: false,
          error: 'Missing required parameters: moId, stageId/stageNo, laborHours, hourlyRate'
        };
      }

      const totalLaborCost = laborHours * hourlyRate;
      const orgId = await this.getOrgId();

      // Resolve stage number
      let targetStageNo = stageNo;
      if (stageId && !stageNo) {
        targetStageNo = await this.repository.getStageNumber(stageId);
      }

      if (!targetStageNo) {
        return {
          success: false,
          error: 'stage_no is required. Please provide either stageNo or stageId.'
        };
      }

      // Resolve work center
      let resolvedWorkCenterId = workCenterId;
      if (!resolvedWorkCenterId) {
        resolvedWorkCenterId = await this.repository.getDefaultWorkCenter(orgId);
      }

      if (!resolvedWorkCenterId) {
        return {
          success: false,
          error: 'workCenterId is required. No default work center found.'
        };
      }

      // Insert labor time log
      const result = await this.repository.insertLaborTimeLog({
        orgId,
        moId,
        stageNo: targetStageNo,
        workCenterId: resolvedWorkCenterId,
        hours: laborHours,
        hourlyRate,
        employeeName,
        operationCode,
        notes
      });

      // Check if database insert succeeded
      if (!result?.id) {
        console.error('Failed to insert labor time log - no ID returned');
        return {
          success: false,
          error: 'Failed to save labor time record to database'
        };
      }

      return {
        success: true,
        data: {
          id: result.id,
          totalLaborCost,
          hours: laborHours,
          hourlyRate
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error applying labor time:', error);
      return { success: false, error: message };
    }
  }

  /**
   * Apply overhead costs to a manufacturing stage
   */
  async applyOverhead(params: ProcessCostingParams): Promise<OperationResult<OverheadResult>> {
    try {
      const { moId, stageId, stageNo, workCenterId, baseQty, overheadRate, overheadType, notes } = params;

      // Validation
      if (!moId || (!stageId && !stageNo) || !baseQty || !overheadRate) {
        return {
          success: false,
          error: 'Missing required parameters: moId, stageId/stageNo, baseQty, overheadRate'
        };
      }

      const overheadAmount = baseQty * overheadRate;
      const orgId = await this.getOrgId();

      // Resolve stage number
      let targetStageNo = stageNo;
      if (stageId && !stageNo) {
        targetStageNo = await this.repository.getStageNumber(stageId);
      }

      if (!targetStageNo) {
        return {
          success: false,
          error: 'stage_no is required. Please provide either stageNo or stageId.'
        };
      }

      // Resolve work center
      let resolvedWorkCenterId = workCenterId;
      if (!resolvedWorkCenterId) {
        resolvedWorkCenterId = await this.repository.getDefaultWorkCenter(orgId);
      }

      if (!resolvedWorkCenterId) {
        return {
          success: false,
          error: 'workCenterId is required. No default work center found.'
        };
      }

      // Insert overhead record
      const result = await this.repository.insertOverheadApplied({
        orgId,
        moId,
        stageNo: targetStageNo,
        workCenterId: resolvedWorkCenterId,
        baseQty,
        overheadRate,
        overheadType,
        notes
      });

      // Check if database insert succeeded
      if (!result?.id) {
        console.error('Failed to insert overhead record - no ID returned');
        return {
          success: false,
          error: 'Failed to save overhead record to database'
        };
      }

      return {
        success: true,
        data: {
          id: result.id,
          overheadAmount,
          baseQty,
          rate: overheadRate
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error applying overhead:', error);
      return { success: false, error: message };
    }
  }

  /**
   * Create or update stage cost
   */
  async upsertStageCost(params: ProcessCostingParams): Promise<OperationResult<StageCostResult>> {
    try {
      const { moId, stageId, stageNo, workCenterId, goodQty, scrapQty, directMaterialCost, mode } = params;

      // Validation - allow goodQty = 0 for 100% scrap scenarios
      if (!moId || (!stageId && !stageNo) || goodQty === undefined || goodQty === null) {
        return {
          success: false,
          error: 'Missing required parameters: moId, stageId/stageNo, goodQty'
        };
      }

      const orgId = await this.getOrgId();

      // Resolve stage number
      let targetStageNo = stageNo;
      if (stageId && !stageNo) {
        targetStageNo = await this.repository.getStageNumber(stageId);
      }

      // Validate stage number - required for proper cost tracking
      if (!targetStageNo) {
        return {
          success: false,
          error: 'stage_no is required. Please provide either stageNo or stageId.'
        };
      }

      // Get labor costs for this stage
      const laborCost = await this.repository.getLaborCostsByStage(moId, targetStageNo);

      // Get overhead costs for this stage
      const overheadCost = await this.repository.getOverheadCostsByStage(moId, targetStageNo);

      // Calculate totals
      const materialCost = directMaterialCost || 0;
      const totalCost = materialCost + laborCost + overheadCost;
      const unitCost = goodQty > 0 ? totalCost / goodQty : 0;

      // Upsert stage cost
      const result = await this.repository.upsertStageCostRecord({
        orgId,
        moId,
        stageId: stageId || undefined,
        stageNo: targetStageNo || undefined,
        workCenterId,
        goodQty,
        scrapQty: scrapQty || 0,
        materialCost,
        laborCost,
        overheadCost,
        totalCost,
        unitCost,
        status: mode || 'actual'
      });

      return {
        success: true,
        data: result || {
          manufacturing_order_id: moId,
          stage_id: stageId || undefined,
          stage_number: targetStageNo || undefined,
          work_center_id: workCenterId || undefined,
          good_quantity: goodQty,
          scrap_quantity: scrapQty || 0,
          material_cost: materialCost,
          labor_cost: laborCost,
          overhead_cost: overheadCost,
          total_cost: totalCost,
          unit_cost: unitCost,
          status: mode || 'actual'
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error upserting stage cost:', error);
      return { success: false, error: message };
    }
  }

  /**
   * Get all stage costs for a manufacturing order
   */
  async getStageCosts(moId: string): Promise<OperationResult<StageCostResult[]>> {
    try {
      if (!moId) {
        return { success: false, error: 'Missing required parameter: moId' };
      }

      const data = await this.repository.getStageCostsByMO(moId);
      return { success: true, data };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error getting stage costs:', error);
      return { success: false, error: message };
    }
  }

  /**
   * Get complete cost summary for a manufacturing order
   */
  async getManufacturingOrderCostSummary(moId: string): Promise<OperationResult<ManufacturingOrderCostSummary>> {
    try {
      if (!moId) {
        return { success: false, error: 'Missing required parameter: moId' };
      }

      // Get manufacturing order details
      const orderDetails = await this.repository.getManufacturingOrderDetails(moId);
      if (!orderDetails) {
        return { success: false, error: 'Manufacturing order not found' };
      }

      // Get stage costs
      const stageCosts = await this.repository.getStageCostsByMO(moId);

      // Calculate totals
      const totalMaterialCost = stageCosts.reduce((sum, sc) => sum + sc.material_cost, 0);
      const totalLaborCost = stageCosts.reduce((sum, sc) => sum + sc.labor_cost, 0);
      const totalOverheadCost = stageCosts.reduce((sum, sc) => sum + sc.overhead_cost, 0);
      const totalCost = totalMaterialCost + totalLaborCost + totalOverheadCost;
      const unitCost = orderDetails.completedQty > 0 ? totalCost / orderDetails.completedQty : 0;

      // Calculate variance if standard cost is available
      let variance: number | undefined;
      let variancePercentage: number | undefined;
      if (orderDetails.standardCost) {
        const standardTotalCost = orderDetails.standardCost * orderDetails.completedQty;
        variance = totalCost - standardTotalCost;
        variancePercentage = standardTotalCost > 0 ? (variance / standardTotalCost) * 100 : 0;
      }

      return {
        success: true,
        data: {
          moId,
          orderNumber: orderDetails.orderNumber,
          productName: orderDetails.productName,
          plannedQty: orderDetails.plannedQty,
          completedQty: orderDetails.completedQty,
          totalMaterialCost,
          totalLaborCost,
          totalOverheadCost,
          totalCost,
          unitCost,
          stageCosts,
          variance,
          variancePercentage
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error getting manufacturing order cost summary:', error);
      return { success: false, error: message };
    }
  }

  /**
   * Calculate variance between actual and standard costs
   */
  async calculateVariance(moId: string): Promise<OperationResult<{
    materialVariance: number;
    laborVariance: number;
    overheadVariance: number;
    totalVariance: number;
  }>> {
    try {
      // Get actual costs from domain repository
      // Note: These are fetched for future standard cost comparison implementation
      const directMaterials = await this.repository.getDirectMaterials(moId);
      const directLabor = await this.repository.getDirectLabor(moId);
      const overheadCosts = await this.repository.getOverheadCosts(moId);

      // Calculate actual totals (will be used when standard costs are implemented)
      const _actualMaterialCost = directMaterials.reduce((sum, dm) => sum + dm.totalCost, 0);
      const _actualLaborCost = directLabor.reduce((sum, dl) => sum + dl.totalCost, 0);
      const _actualOverheadCost = overheadCosts.reduce((sum, oc) => sum + oc.amount, 0);

      // FUTURE: Standard cost comparison will be implemented in Phase 3
      // Currently returns zero variance (actual costs match expected)
      const materialVariance = 0;
      const laborVariance = 0;
      const overheadVariance = 0;
      const totalVariance = materialVariance + laborVariance + overheadVariance;

      return {
        success: true,
        data: {
          materialVariance,
          laborVariance,
          overheadVariance,
          totalVariance
        }
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error calculating variance:', error);
      return { success: false, error: message };
    }
  }
}


