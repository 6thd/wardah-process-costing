/**
 * Supabase Implementation of IInventoryValuationRepository
 * 
 * This adapter implements the inventory valuation repository interface
 * using Supabase as the underlying data store.
 * 
 * @layer Infrastructure
 * @pattern Repository Pattern + Adapter Pattern
 */

import { getSupabase, getConfig } from '@/core/supabaseClient'
import { extractTenantFromJWT } from '@/core/security'

// Helper function for tenant ID
const getCurrentTenantId = async (): Promise<string | null> => {
  return extractTenantFromJWT()
}
import type {
  IInventoryValuationRepository,
  InventoryMovementInput,
  InventoryMovementResult,
  ItemValuationData,
  ProductBatch,
  COGSSimulation,
  ValuationByMethodSummary,
  ValuationTotals
} from '@/domain/interfaces/IInventoryValuationRepository'
import {
  processIncomingStock,
  processOutgoingStock
} from '@/domain/inventory/valuation'

/**
 * SupabaseInventoryValuationRepository
 * 
 * Concrete implementation of inventory valuation operations using Supabase.
 * Handles multi-method valuation (FIFO, LIFO, Weighted Average, Moving Average).
 */
export class SupabaseInventoryValuationRepository implements IInventoryValuationRepository {
  private readonly supabase = getSupabase()
  private readonly config = getConfig()

  /**
   * Record an inventory movement with automatic valuation calculation
   */
  async recordInventoryMovement(input: InventoryMovementInput): Promise<InventoryMovementResult> {
    const {
      itemId,
      moveType,
      refType = null,
      refId = null,
      refNumber = null,
      qtyIn = 0,
      qtyOut = 0,
      unitCost = 0,
      lotNumber = null,
      expiryDate = null,
      locationCode = null,
      notes = null,
      updateItemStock = true
    } = input

    // Validation
    this.validateMovementInput(input)

    const tenantId = await getCurrentTenantId()
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Get current item with valuation method
    const itemData = await this.getItemValuation(itemId)
    if (!itemData) {
      throw new Error(`Item not found: ${itemId}`)
    }

    const { stock_quantity: currentStock, cost_price: currentUnitCost, stock_value: currentValue, stock_queue: currentQueue, valuation_method: valuationMethod } = itemData

    // Create product object for valuation functions
    const product = {
      id: itemId,
      code: itemId,
      name: 'Product',
      valuation_method: valuationMethod,
      stock_quantity: currentStock,
      cost_price: currentUnitCost,
      stock_value: currentValue,
      stock_queue: currentQueue
    }

    let newStock = currentStock
    let newUnitCost = currentUnitCost
    let newValue = currentValue
    let newQueue = currentQueue
    let totalCost = 0
    let costOfGoodsSold = 0

    // Calculate new values using valuation strategies
    if (qtyIn > 0) {
      // Incoming stock - use processIncomingStock
      console.log(`📦 Recording incoming stock: ${qtyIn} @ ${unitCost}`)

      const result = await processIncomingStock(product, qtyIn, unitCost)

      newStock = result.newQty
      newUnitCost = result.newRate
      newValue = result.newValue
      newQueue = result.newQueue
      totalCost = qtyIn * unitCost

      console.log(`✅ New stock state:`, {
        qty: newStock,
        rate: newUnitCost,
        value: newValue,
        batches: newQueue.length
      })
    } else if (qtyOut > 0) {
      // Outgoing stock - use processOutgoingStock
      console.log(`📤 Recording outgoing stock: ${qtyOut}`)

      if (currentStock < qtyOut) {
        throw new Error(
          `Insufficient stock. Available: ${currentStock}, Required: ${qtyOut}`
        )
      }

      const result = await processOutgoingStock(product, qtyOut)

      newStock = result.newQty
      newUnitCost = result.newRate
      newValue = result.newValue
      newQueue = result.newQueue
      costOfGoodsSold = result.costOfGoodsSold || 0
      totalCost = -costOfGoodsSold // Negative for outgoing

      console.log(`✅ Stock issued:`, {
        quantity: qtyOut,
        cogs: costOfGoodsSold,
        remainingQty: newStock,
        remainingValue: newValue,
        remainingBatches: newQueue.length
      })
    }

    // Calculate running values for ledger
    const runningBalance = newStock
    const runningValue = newValue
    const avgUnitCost = newUnitCost

    // Begin transaction - insert ledger entry
    const { data: ledgerData, error: ledgerError } = await this.supabase
      .from(this.config.TABLE_NAMES.inventory_ledger)
      .insert({
        tenant_id: tenantId,
        item_id: itemId,
        move_type: moveType,
        ref_type: refType,
        ref_id: refId,
        ref_number: refNumber,
        qty_in: qtyIn,
        qty_out: qtyOut,
        unit_cost: qtyIn > 0 ? unitCost : (costOfGoodsSold / qtyOut),
        total_cost: totalCost,
        running_balance: runningBalance,
        running_value: runningValue,
        avg_unit_cost: avgUnitCost,
        lot_number: lotNumber,
        expiry_date: expiryDate,
        location_code: locationCode,
        notes: notes,
        moved_at: new Date().toISOString()
      })
      .select()
      .single()

    if (ledgerError) throw ledgerError

    // Update item stock, cost, value, and queue
    if (updateItemStock) {
      const updateData: Record<string, unknown> = {
        stock_quantity: newStock,
        cost_price: newUnitCost,
        stock_value: newValue,
        updated_at: new Date().toISOString()
      }

      // Only update queue for FIFO/LIFO methods
      if (valuationMethod === 'FIFO' || valuationMethod === 'LIFO') {
        updateData.stock_queue = newQueue
      }

      const { error: updateError } = await this.supabase
        .from(this.config.TABLE_NAMES.items)
        .update(updateData)
        .eq('id', itemId)
        .eq('tenant_id', tenantId)

      if (updateError) throw updateError
    }

    return {
      ledgerEntry: ledgerData,
      valuationMethod: valuationMethod,
      stockBefore: currentStock,
      stockAfter: newStock,
      costBefore: currentUnitCost,
      costAfter: newUnitCost,
      valueBefore: currentValue,
      valueAfter: newValue,
      totalCostImpact: totalCost,
      costOfGoodsSold: costOfGoodsSold,
      batchCount: newQueue.length
    }
  }

  /**
   * Get current item valuation data
   */
  async getItemValuation(itemId: string): Promise<ItemValuationData | null> {
    const tenantId = await getCurrentTenantId()
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    const { data, error } = await this.supabase
      .from(this.config.TABLE_NAMES.items)
      .select('stock_quantity, cost_price, stock_value, stock_queue, valuation_method')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null // Not found
      throw error
    }

    return {
      id: itemId,
      stock_quantity: data.stock_quantity || 0,
      cost_price: data.cost_price || 0,
      stock_value: data.stock_value || 0,
      stock_queue: data.stock_queue || [],
      valuation_method: data.valuation_method || 'Weighted Average'
    }
  }

  /**
   * Get product batches for FIFO/LIFO products
   */
  async getProductBatches(itemId: string): Promise<ProductBatch[]> {
    const { data, error } = await this.supabase
      .rpc('get_product_batches', { p_product_id: itemId })

    if (error) throw error

    return data || []
  }

  /**
   * Simulate COGS calculation without actually issuing stock
   */
  async simulateCOGS(itemId: string, quantity: number): Promise<COGSSimulation> {
    if (quantity <= 0) {
      throw new Error('Quantity must be positive')
    }

    const { data, error } = await this.supabase
      .rpc('simulate_cogs', {
        p_product_id: itemId,
        p_quantity: quantity
      })

    if (error) throw error

    return data
  }

  /**
   * Get inventory valuation by method
   */
  async getInventoryValuationByMethod(): Promise<{
    by_method: ValuationByMethodSummary[]
    totals: ValuationTotals
  }> {
    const tenantId = await getCurrentTenantId()
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Use the view created by SQL script
    const { data, error } = await this.supabase
      .from('vw_stock_valuation_by_method')
      .select('*')
      .eq('tenant_id', tenantId)

    if (error) throw error

    // Group by valuation method
    const byMethodMap = (data || []).reduce<Record<string, ValuationByMethodSummary>>((acc, item) => {
      const method = item.valuation_method || 'Unknown'
      if (!acc[method]) {
        acc[method] = {
          method: method,
          items_count: 0,
          total_quantity: 0,
          total_value: 0,
          items: []
        }
      }

      acc[method].items_count++
      acc[method].total_quantity += item.stock_quantity || 0
      acc[method].total_value += item.stock_value || 0
      acc[method].items.push({
        item_id: item.item_id,
        item_code: item.item_code,
        item_name: item.item_name,
        stock_quantity: item.stock_quantity || 0,
        cost_price: item.cost_price || 0,
        stock_value: item.stock_value || 0
      })

      return acc
    }, {})

    const totals: ValuationTotals = {
      total_items: data?.length || 0,
      total_quantity: (data || []).reduce((sum, item) => sum + (item.stock_quantity || 0), 0),
      total_value: (data || []).reduce((sum, item) => sum + (item.stock_value || 0), 0)
    }

    return {
      by_method: Object.values(byMethodMap),
      totals
    }
  }

  /**
   * Private helper: validate movement input
   */
  private validateMovementInput(input: InventoryMovementInput): void {
    const { itemId, moveType, qtyIn = 0, qtyOut = 0 } = input

    if (!itemId) {
      throw new Error('Item ID is required')
    }

    if (!moveType) {
      throw new Error('Move Type is required')
    }

    if (qtyIn <= 0 && qtyOut <= 0) {
      throw new Error('Either quantity in or quantity out must be positive')
    }

    if (qtyIn > 0 && qtyOut > 0) {
      throw new Error('Cannot have both quantity in and quantity out in same movement')
    }

    const validMoveTypes = ['PURCHASE_IN', 'PROD_IN', 'MO_CONS', 'SALE_OUT', 'ADJ_IN', 'ADJ_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']
    if (!validMoveTypes.includes(moveType)) {
      throw new Error(`Invalid move type. Must be one of: ${validMoveTypes.join(', ')}`)
    }
  }
}

