/**
 * IInventoryValuationRepository - Domain Interface
 * Repository interface for inventory valuation operations
 * 
 * This interface defines the contract for inventory valuation persistence,
 * following the Repository Pattern and Dependency Inversion Principle.
 * 
 * Implementations should handle:
 * - Multi-method valuation (FIFO, LIFO, Weighted Average, Moving Average)
 * - Inventory movements with valuation calculations
 * - Batch/Queue management for FIFO/LIFO
 * - COGS calculation
 */

export interface InventoryMovementInput {
  itemId: string
  moveType: 'PURCHASE_IN' | 'PROD_IN' | 'MO_CONS' | 'SALE_OUT' | 'ADJ_IN' | 'ADJ_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT'
  refType?: string | null
  refId?: string | null
  refNumber?: string | null
  qtyIn?: number
  qtyOut?: number
  unitCost?: number
  lotNumber?: string | null
  expiryDate?: string | null
  locationCode?: string | null
  notes?: string | null
  updateItemStock?: boolean
}

export interface InventoryMovementResult {
  ledgerEntry: InventoryLedgerEntry
  valuationMethod: string
  stockBefore: number
  stockAfter: number
  costBefore: number
  costAfter: number
  valueBefore: number
  valueAfter: number
  totalCostImpact: number
  costOfGoodsSold: number
  batchCount: number
}

export interface InventoryLedgerEntry {
  id: string
  tenant_id: string
  item_id: string
  move_type: string
  ref_type?: string | null
  ref_id?: string | null
  ref_number?: string | null
  qty_in: number
  qty_out: number
  unit_cost: number
  total_cost: number
  running_balance: number
  running_value: number
  avg_unit_cost: number
  lot_number?: string | null
  expiry_date?: string | null
  location_code?: string | null
  notes?: string | null
  moved_at: string
}

export interface ItemValuationData {
  id: string
  stock_quantity: number
  cost_price: number
  stock_value: number
  stock_queue: StockBatch[]
  valuation_method: 'FIFO' | 'LIFO' | 'Weighted Average' | 'Moving Average'
}

export interface StockBatch {
  qty: number
  rate: number
  receivedAt?: string
}

export interface ProductBatch {
  batch_id: string
  qty: number
  rate: number
  received_at: string
}

export interface COGSSimulation {
  itemId: string
  requestedQty: number
  availableQty: number
  cogs: number
  avgCost: number
  batchesUsed: Array<{
    batchId: string
    qtyUsed: number
    rate: number
  }>
}

export interface ValuationByMethodSummary {
  method: string
  items_count: number
  total_quantity: number
  total_value: number
  items: Array<{
    item_id: string
    item_code: string
    item_name: string
    stock_quantity: number
    cost_price: number
    stock_value: number
  }>
}

export interface ValuationTotals {
  total_items: number
  total_quantity: number
  total_value: number
}

/**
 * IInventoryValuationRepository Interface
 * 
 * @description
 * Defines the contract for inventory valuation operations without
 * exposing any infrastructure details (e.g., Supabase, SQL).
 * 
 * Domain layer depends on this interface, while Infrastructure
 * layer provides the concrete implementation.
 */
export interface IInventoryValuationRepository {
  /**
   * Record an inventory movement with automatic valuation calculation
   * based on the item's configured valuation method
   * 
   * @param input - Movement details (item, quantities, costs, etc.)
   * @returns Movement result with updated stock and cost information
   */
  recordInventoryMovement(input: InventoryMovementInput): Promise<InventoryMovementResult>

  /**
   * Get current item valuation data including stock queue for FIFO/LIFO
   * 
   * @param itemId - Item identifier
   * @returns Item valuation data or null if not found
   */
  getItemValuation(itemId: string): Promise<ItemValuationData | null>

  /**
   * Get product batches for FIFO/LIFO valuation methods
   * 
   * @param itemId - Item identifier
   * @returns Array of batches ordered appropriately for the valuation method
   */
  getProductBatches(itemId: string): Promise<ProductBatch[]>

  /**
   * Simulate COGS calculation without actually issuing stock
   * Useful for pricing decisions and profit margin calculations
   * 
   * @param itemId - Item identifier
   * @param quantity - Quantity to simulate issuing
   * @returns COGS simulation result
   */
  simulateCOGS(itemId: string, quantity: number): Promise<COGSSimulation>

  /**
   * Get inventory valuation summary grouped by valuation method
   * Useful for management reports and inventory analysis
   * 
   * @returns Valuation data grouped by method with totals
   */
  getInventoryValuationByMethod(): Promise<{
    by_method: ValuationByMethodSummary[]
    totals: ValuationTotals
  }>
}

