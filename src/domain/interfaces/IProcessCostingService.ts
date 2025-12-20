/**
 * IProcessCostingService - Domain Interface (Port)
 * 
 * Service interface for process costing operations.
 * Supports stage_id (UUID) and stage_number (legacy) for backward compatibility.
 */

/**
 * Parameters for process costing operations
 */
export interface ProcessCostingParams {
  /** Manufacturing Order ID */
  moId: string;
  /** Stage ID (UUID from manufacturing_stages) - NEW */
  stageId?: string | null;
  /** Stage Number (legacy fallback) */
  stageNo?: number | null;
  /** Work Center ID */
  workCenterId?: string;
  /** Good quantity produced */
  goodQty?: number;
  /** Scrap quantity */
  scrapQty?: number;
  /** Rework quantity */
  reworkQty?: number;
  /** Direct material cost */
  directMaterialCost?: number;
  /** Labor hours worked */
  laborHours?: number;
  /** Hourly labor rate */
  hourlyRate?: number;
  /** Overhead rate */
  overheadRate?: number;
  /** Base quantity for overhead allocation */
  baseQty?: number;
  /** Overhead type (variable/fixed) */
  overheadType?: string;
  /** Employee name for labor tracking */
  employeeName?: string;
  /** Operation code */
  operationCode?: string;
  /** Notes/comments */
  notes?: string;
  /** Costing mode */
  mode?: 'precosted' | 'actual' | 'completed';
}

/**
 * Result of stage cost calculation
 */
export interface StageCostResult {
  /** Record ID */
  id?: string;
  /** Manufacturing Order ID */
  manufacturing_order_id: string;
  /** Stage ID (UUID) */
  stage_id?: string;
  /** Stage Number (legacy) */
  stage_number?: number;
  /** Work Center ID */
  work_center_id?: string;
  /** Good quantity */
  good_quantity: number;
  /** Scrap quantity */
  scrap_quantity: number;
  /** Material cost */
  material_cost: number;
  /** Labor cost */
  labor_cost: number;
  /** Overhead cost */
  overhead_cost: number;
  /** Total cost */
  total_cost: number;
  /** Unit cost */
  unit_cost: number;
  /** Status */
  status: string;
}

/**
 * Result of labor time application
 */
export interface LaborTimeResult {
  /** Record ID */
  id: string;
  /** Total labor cost calculated */
  totalLaborCost: number;
  /** Hours worked */
  hours: number;
  /** Hourly rate used */
  hourlyRate: number;
}

/**
 * Result of overhead application
 */
export interface OverheadResult {
  /** Record ID */
  id: string;
  /** Total overhead amount */
  overheadAmount: number;
  /** Base quantity used */
  baseQty: number;
  /** Overhead rate used */
  rate: number;
}

/**
 * Manufacturing order cost summary
 */
export interface ManufacturingOrderCostSummary {
  /** Manufacturing Order ID */
  moId: string;
  /** Order number */
  orderNumber: string;
  /** Product being manufactured */
  productName: string;
  /** Planned quantity */
  plannedQty: number;
  /** Completed quantity */
  completedQty: number;
  /** Total material cost */
  totalMaterialCost: number;
  /** Total labor cost */
  totalLaborCost: number;
  /** Total overhead cost */
  totalOverheadCost: number;
  /** Total cost */
  totalCost: number;
  /** Unit cost */
  unitCost: number;
  /** Stage costs breakdown */
  stageCosts: StageCostResult[];
  /** Variance from standard cost */
  variance?: number;
  /** Variance percentage */
  variancePercentage?: number;
}

/**
 * Operation result wrapper
 */
export interface OperationResult<T> {
  /** Success indicator */
  success: boolean;
  /** Result data */
  data?: T;
  /** Error message if failed */
  error?: string;
}

/**
 * IProcessCostingService - Service Interface
 * 
 * Defines the contract for process costing operations.
 */
export interface IProcessCostingService {
  /**
   * Apply labor time to a manufacturing stage
   * 
   * @param params - Labor time parameters
   * @returns Labor time result
   */
  applyLaborTime(params: ProcessCostingParams): Promise<OperationResult<LaborTimeResult>>;

  /**
   * Apply overhead costs to a manufacturing stage
   * 
   * @param params - Overhead parameters
   * @returns Overhead result
   */
  applyOverhead(params: ProcessCostingParams): Promise<OperationResult<OverheadResult>>;

  /**
   * Create or update stage cost
   * 
   * @param params - Stage cost parameters
   * @returns Stage cost result
   */
  upsertStageCost(params: ProcessCostingParams): Promise<OperationResult<StageCostResult>>;

  /**
   * Get all stage costs for a manufacturing order
   * 
   * @param moId - Manufacturing Order ID
   * @returns Array of stage costs
   */
  getStageCosts(moId: string): Promise<OperationResult<StageCostResult[]>>;

  /**
   * Get complete cost summary for a manufacturing order
   * 
   * @param moId - Manufacturing Order ID
   * @returns Cost summary with breakdown
   */
  getManufacturingOrderCostSummary(moId: string): Promise<OperationResult<ManufacturingOrderCostSummary>>;

  /**
   * Calculate variance between actual and standard costs
   * 
   * @param moId - Manufacturing Order ID
   * @returns Variance analysis
   */
  calculateVariance(moId: string): Promise<OperationResult<{
    materialVariance: number;
    laborVariance: number;
    overheadVariance: number;
    totalVariance: number;
  }>>;
}


