/**
 * AVCO (Average Cost) Inventory Management
 * Advanced inventory costing with multi-tenant support
 */

import { createSecureRPC, validateInput } from '../../core/security.ts'
import { getSupabase, getTenantId } from '../../core/supabase'
import { getTableName } from '../../core/config'

// AVCO transaction types
export type AVCOTransactionType = 
  | 'purchase'      // Incoming stock from suppliers
  | 'receipt'       // General incoming stock
  | 'issue'         // General outgoing stock  
  | 'consumption'   // Material consumption for production
  | 'production'    // Finished goods from production
  | 'sale'          // Stock sold to customers
  | 'adjustment_in' // Positive inventory adjustment
  | 'adjustment_out'// Negative inventory adjustment
  | 'transfer_in'   // Stock transferred in
  | 'transfer_out'  // Stock transferred out

// AVCO calculation result
export interface AVCOResult {
  newAvgCost: number
  newRunningQty: number
  newRunningValue: number
  transactionCost: number
}

// Inventory transaction interface
export interface InventoryTransaction {
  itemId: string
  moveType: AVCOTransactionType
  quantity: number
  unitCost: number
  referenceType?: string
  referenceId?: string
  referenceNumber?: string
  notes?: string
}

// Item inventory state
export interface ItemInventoryState {
  itemId: string
  currentQty: number
  currentValue: number
  avgCost: number
  lastUpdateDate: string
}

/**
 * AVCO Calculator Class
 */
export class AVCOCalculator {
  private tenantId: string | null = null

  constructor() {
    this.initializeTenant()
  }

  private async initializeTenant() {
    this.tenantId = await getTenantId()
  }

  /**
   * Calculate AVCO for a single transaction
   */
  calculateAVCO(
    currentQty: number,
    currentValue: number,
    transactionQty: number,
    transactionUnitCost: number,
    isIncoming: boolean
  ): AVCOResult {
    let newQty: number
    let newValue: number
    let newAvgCost: number
    let transactionCost: number

    if (isIncoming) {
      // Incoming stock - add quantity and value
      newQty = currentQty + transactionQty
      transactionCost = transactionQty * transactionUnitCost
      newValue = currentValue + transactionCost
      
      // Calculate new average cost
      newAvgCost = newQty > 0 ? newValue / newQty : 0
      
    } else {
      // Outgoing stock - reduce quantity at current average cost
      if (transactionQty > currentQty) {
        throw new Error(`Insufficient inventory. Available: ${currentQty}, Requested: ${transactionQty}`)
      }
      
      const currentAvgCost = currentQty > 0 ? currentValue / currentQty : 0
      transactionCost = transactionQty * currentAvgCost
      
      newQty = currentQty - transactionQty
      newValue = currentValue - transactionCost
      
      // Maintain current average cost
      newAvgCost = newQty > 0 ? newValue / newQty : 0
    }

    return {
      newAvgCost,
      newRunningQty: newQty,
      newRunningValue: newValue,
      transactionCost
    }
  }

  /**
   * Process inventory transaction with AVCO
   */
  async processTransaction(transaction: InventoryTransaction): Promise<AVCOResult> {
    try {
      // Validate inputs
      this.validateTransaction(transaction)

      // Get current inventory state
      const currentState = await this.getCurrentInventoryState(transaction.itemId)

      // Determine if transaction is incoming or outgoing
      const incomingTypes: AVCOTransactionType[] = [
        'purchase', 'receipt', 'production', 'adjustment_in', 'transfer_in'
      ]
      const isIncoming = incomingTypes.includes(transaction.moveType)

      // Calculate AVCO
      const result = this.calculateAVCO(
        currentState.currentQty,
        currentState.currentValue,
        transaction.quantity,
        transaction.unitCost,
        isIncoming
      )

      // Update database using secure RPC
      await this.updateInventoryDatabase(transaction)

      return result

    } catch (error) {
      console.error('AVCO transaction processing failed:', error)
      throw error
    }
  }

  /**
   * Batch process multiple transactions (useful for complex operations)
   */
  async processBatchTransactions(transactions: InventoryTransaction[]): Promise<AVCOResult[]> {
    const results: AVCOResult[] = []
    
    // Process transactions sequentially to maintain AVCO integrity
    for (const transaction of transactions) {
      try {
        const result = await this.processTransaction(transaction)
        results.push(result)
      } catch (error) {
        console.error(`Failed to process transaction for item ${transaction.itemId}:`, error)
        throw error
      }
    }

    return results
  }

  /**
   * Get current inventory state for an item
   */
  private async getCurrentInventoryState(itemId: string): Promise<ItemInventoryState> {
    const client = await getSupabase()
    
    const { data, error } = await client
      .from(getTableName('items'))
      .select('stock_quantity, current_avg_cost, updated_at')
      .eq('id', itemId)
      .eq('tenant_id', this.tenantId)
      .single()

    if (error) {
      throw new Error(`Failed to get inventory state: ${error.message}`)
    }

    if (!data) {
      throw new Error('Item not found')
    }

    const currentValue = data.stock_quantity * data.current_avg_cost

    return {
      itemId,
      currentQty: data.stock_quantity || 0,
      currentValue: currentValue || 0,
      avgCost: data.current_avg_cost || 0,
      lastUpdateDate: data.updated_at
    }
  }

  /**
   * Update database with AVCO calculation results
   */
  private async updateInventoryDatabase(
    transaction: InventoryTransaction
  ): Promise<void> {
    const updateAVCO = createSecureRPC('update_item_avco')
    
    await updateAVCO({
      p_item_id: transaction.itemId,
      p_quantity: transaction.quantity,
      p_unit_cost: transaction.unitCost,
      p_move_type: transaction.moveType,
      p_reference_type: transaction.referenceType,
      p_reference_id: transaction.referenceId,
      p_reference_number: transaction.referenceNumber
    })
  }

  /**
   * Validate transaction data
   */
  private validateTransaction(transaction: InventoryTransaction): void {
    const errors: string[] = []

    if (!validateInput.uuid(transaction.itemId)) {
      errors.push('Invalid item ID format')
    }

    if (!validateInput.positiveNumber(transaction.quantity)) {
      errors.push('Quantity must be a positive number')
    }

    if (!validateInput.number(transaction.unitCost) || transaction.unitCost < 0) {
      errors.push('Unit cost must be a non-negative number')
    }

    if (!transaction.moveType) {
      errors.push('Move type is required')
    }

    if (errors.length > 0) {
      throw new Error(`Transaction validation failed: ${errors.join(', ')}`)
    }
  }

  /**
   * Get AVCO history for an item
   */
  async getAVCOHistory(itemId: string, daysBack: number = 30): Promise<any[]> {
    const getHistory = createSecureRPC('get_item_avco_history')
    
    return await getHistory({
      p_item_id: itemId,
      p_days_back: daysBack
    })
  }

  /**
   * Calculate current inventory valuation for all items
   */
  async calculateInventoryValuation(): Promise<{ totalValue: number; itemCount: number }> {
    const client = await getSupabase()
    
    const { data, error } = await client
      .from(getTableName('items'))
      .select('stock_quantity, current_avg_cost')
      .eq('tenant_id', this.tenantId)
      .eq('is_active', true)

    if (error) {
      throw new Error(`Failed to calculate inventory valuation: ${error.message}`)
    }

    let totalValue = 0
    let itemCount = 0

    for (const item of data || []) {
      const itemValue = (item.stock_quantity || 0) * (item.current_avg_cost || 0)
      totalValue += itemValue
      if (item.stock_quantity > 0) itemCount++
    }

    return { totalValue, itemCount }
  }

  /**
   * Check for negative inventory (should not happen with proper controls)
   */
  async checkNegativeInventory(): Promise<any[]> {
    const client = await getSupabase()
    
    const { data, error } = await client
      .from(getTableName('items'))
      .select('id, code, name, stock_quantity')
      .eq('tenant_id', this.tenantId)
      .lt('stock_quantity', 0)

    if (error) {
      throw new Error(`Failed to check negative inventory: ${error.message}`)
    }

    return data || []
  }

  /**
   * Adjust inventory for cycle counting
   */
  async adjustInventory(
    itemId: string,
    countedQty: number,
    adjustmentCost: number,
    notes: string = ''
  ): Promise<AVCOResult> {
    const currentState = await this.getCurrentInventoryState(itemId)
    const qtyDifference = countedQty - currentState.currentQty

    if (qtyDifference === 0) {
      return {
        newAvgCost: currentState.avgCost,
        newRunningQty: currentState.currentQty,
        newRunningValue: currentState.currentValue,
        transactionCost: 0
      }
    }

    const moveType: AVCOTransactionType = qtyDifference > 0 ? 'adjustment_in' : 'adjustment_out'

    const transaction: InventoryTransaction = {
      itemId,
      moveType,
      quantity: Math.abs(qtyDifference),
      unitCost: adjustmentCost,
      referenceType: 'cycle_count',
      notes: `Cycle count adjustment: ${notes}`
    }

    return await this.processTransaction(transaction)
  }
}

// Export singleton instance
export const avcoCalculator = new AVCOCalculator()

// Utility functions for common operations

/**
 * Record purchase receipt
 */
export const recordPurchaseReceipt = async (
  itemId: string,
  quantity: number,
  unitCost: number,
  poNumber: string
): Promise<AVCOResult> => {
  return await avcoCalculator.processTransaction({
    itemId,
    moveType: 'purchase',
    quantity,
    unitCost,
    referenceType: 'po',
    referenceNumber: poNumber
  })
}

/**
 * Record material consumption for production
 */
export const recordMaterialConsumption = async (
  itemId: string,
  quantity: number,
  moId: string,
  moNumber: string
): Promise<AVCOResult> => {
  return await avcoCalculator.processTransaction({
    itemId,
    moveType: 'consumption',
    quantity,
    unitCost: 0, // Cost will be determined by AVCO
    referenceType: 'mo',
    referenceId: moId,
    referenceNumber: moNumber
  })
}

/**
 * Record finished goods production
 */
export const recordFinishedGoodsProduction = async (
  itemId: string,
  quantity: number,
  unitCost: number,
  moId: string,
  moNumber: string
): Promise<AVCOResult> => {
  return await avcoCalculator.processTransaction({
    itemId,
    moveType: 'production',
    quantity,
    unitCost,
    referenceType: 'mo',
    referenceId: moId,
    referenceNumber: moNumber
  })
}

/**
 * Record sales delivery
 */
export const recordSalesDelivery = async (
  itemId: string,
  quantity: number,
  soNumber: string
): Promise<AVCOResult> => {
  return await avcoCalculator.processTransaction({
    itemId,
    moveType: 'sale',
    quantity,
    unitCost: 0, // Cost will be determined by AVCO
    referenceType: 'so',
    referenceNumber: soNumber
  })
}

export default {
  AVCOCalculator,
  avcoCalculator,
  recordPurchaseReceipt,
  recordMaterialConsumption,
  recordFinishedGoodsProduction,
  recordSalesDelivery
}