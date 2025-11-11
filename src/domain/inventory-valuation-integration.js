/**
 * Inventory Valuation Integration Module
 * Integrates multi-method valuation (FIFO, LIFO, AVCO) with inventory operations
 * Replaces calculateNewAVCO with strategy-based valuation
 */

import { getSupabase, getConfig } from '../core/supabaseClient.js'
import { getCurrentTenantId } from '../core/security.js'
import { 
  validateRequired, 
  validatePositiveNumber,
  handleError,
  handleSuccess
} from '../core/utils.js'
import {
  processIncomingStock,
  processOutgoingStock,
  getCurrentRate
} from './inventory/valuation'

// ===================================================================
// MULTI-METHOD INVENTORY VALUATION
// ===================================================================

/**
 * Record inventory movement with multi-method valuation support
 * Supports: FIFO, LIFO, Weighted Average, Moving Average
 */
export const recordInventoryMovementV2 = async ({
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
}) => {
  try {
    // Validation
    validateRequired(itemId, 'Item ID')
    validateRequired(moveType, 'Move Type')
    
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
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Get current item with valuation method
    const { data: itemData, error: itemError } = await supabase
      .from(config.TABLE_NAMES.items)
      .select('stock_quantity, cost_price, stock_value, stock_queue, valuation_method')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .single()

    if (itemError) throw itemError

    const currentStock = itemData.stock_quantity || 0
    const currentUnitCost = itemData.cost_price || 0
    const currentValue = itemData.stock_value || 0
    const currentQueue = itemData.stock_queue || []
    const valuationMethod = itemData.valuation_method || 'Weighted Average'
    
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
    const { data: ledgerData, error: ledgerError } = await supabase
      .from(config.TABLE_NAMES.inventory_ledger)
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
      const updateData = {
        stock_quantity: newStock,
        cost_price: newUnitCost,
        stock_value: newValue,
        updated_at: new Date().toISOString()
      }
      
      // Only update queue for FIFO/LIFO methods
      if (valuationMethod === 'FIFO' || valuationMethod === 'LIFO') {
        updateData.stock_queue = newQueue
      }
      
      const { error: updateError } = await supabase
        .from(config.TABLE_NAMES.items)
        .update(updateData)
        .eq('id', itemId)
        .eq('tenant_id', tenantId)

      if (updateError) throw updateError
    }

    return handleSuccess('Inventory movement recorded successfully', {
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
    })

  } catch (error) {
    console.error('❌ Inventory movement error:', error)
    return handleError(error, 'Failed to record inventory movement')
  }
}

// ===================================================================
// INVENTORY OPERATIONS WITH MULTI-METHOD SUPPORT
// ===================================================================

/**
 * Purchase receipt - add inventory with purchase cost
 */
export const receivePurchaseV2 = async ({
  itemId,
  quantity,
  unitCost,
  purchaseOrderId = null,
  lotNumber = null,
  expiryDate = null,
  notes = null
}) => {
  try {
    validatePositiveNumber(quantity, 'Quantity')
    validatePositiveNumber(unitCost, 'Unit Cost')

    return await recordInventoryMovementV2({
      itemId,
      moveType: 'PURCHASE_IN',
      refType: 'PO',
      refId: purchaseOrderId,
      qtyIn: quantity,
      unitCost,
      lotNumber,
      expiryDate,
      notes
    })

  } catch (error) {
    return handleError(error, 'Failed to receive purchase')
  }
}

/**
 * Production receipt - add inventory from manufacturing
 */
export const receiveProductionV2 = async ({
  itemId,
  quantity,
  unitCost,
  manufacturingOrderId,
  batchNumber = null,
  notes = null
}) => {
  try {
    validatePositiveNumber(quantity, 'Quantity')
    validatePositiveNumber(unitCost, 'Unit Cost')

    return await recordInventoryMovementV2({
      itemId,
      moveType: 'PROD_IN',
      refType: 'MO',
      refId: manufacturingOrderId,
      refNumber: batchNumber,
      qtyIn: quantity,
      unitCost,
      notes
    })

  } catch (error) {
    return handleError(error, 'Failed to receive production')
  }
}

/**
 * Sales shipment - reduce inventory for sales (COGS calculated by valuation method)
 */
export const shipSalesV2 = async ({
  itemId,
  quantity,
  salesOrderId = null,
  notes = null
}) => {
  try {
    validatePositiveNumber(quantity, 'Quantity')

    return await recordInventoryMovementV2({
      itemId,
      moveType: 'SALE_OUT',
      refType: 'SO',
      refId: salesOrderId,
      qtyOut: quantity,
      notes
    })

  } catch (error) {
    return handleError(error, 'Failed to ship sales')
  }
}

/**
 * Manufacturing consumption - reduce inventory for production
 */
export const consumeForManufacturingV2 = async ({
  itemId,
  quantity,
  manufacturingOrderId,
  stageNumber = null,
  notes = null
}) => {
  try {
    validatePositiveNumber(quantity, 'Quantity')

    return await recordInventoryMovementV2({
      itemId,
      moveType: 'MO_CONS',
      refType: 'MO',
      refId: manufacturingOrderId,
      refNumber: stageNumber ? `Stage ${stageNumber}` : null,
      qtyOut: quantity,
      notes
    })

  } catch (error) {
    return handleError(error, 'Failed to consume for manufacturing')
  }
}

/**
 * Inventory adjustment - positive or negative adjustment
 */
export const adjustInventoryV2 = async ({
  itemId,
  adjustmentQty,
  adjustmentCost = null,
  reason = null,
  notes = null
}) => {
  try {
    if (adjustmentQty === 0) {
      throw new Error('Adjustment quantity cannot be zero')
    }

    const isPositive = adjustmentQty > 0
    const moveType = isPositive ? 'ADJ_IN' : 'ADJ_OUT'
    const qtyIn = isPositive ? adjustmentQty : 0
    const qtyOut = isPositive ? 0 : Math.abs(adjustmentQty)

    return await recordInventoryMovementV2({
      itemId,
      moveType,
      refType: 'ADJ',
      qtyIn,
      qtyOut,
      unitCost: adjustmentCost || 0,
      notes: reason ? `${reason}: ${notes || ''}` : notes
    })

  } catch (error) {
    return handleError(error, 'Failed to adjust inventory')
  }
}

// ===================================================================
// VALUATION-SPECIFIC QUERIES
// ===================================================================

/**
 * Get product batches for FIFO/LIFO products
 */
export const getProductBatches = async (itemId) => {
  try {
    validateRequired(itemId, 'Item ID')
    
    const supabase = getSupabase()
    
    // Use SQL function to get batches
    const { data, error } = await supabase
      .rpc('get_product_batches', { p_product_id: itemId })

    if (error) throw error

    return handleSuccess('Product batches retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get product batches')
  }
}

/**
 * Simulate COGS calculation without actually issuing stock
 */
export const simulateCOGS = async (itemId, quantity) => {
  try {
    validateRequired(itemId, 'Item ID')
    validatePositiveNumber(quantity, 'Quantity')
    
    const supabase = getSupabase()
    
    // Use SQL function to simulate COGS
    const { data, error } = await supabase
      .rpc('simulate_cogs', { 
        p_product_id: itemId,
        p_quantity: quantity 
      })

    if (error) throw error

    return handleSuccess('COGS simulation completed', data)

  } catch (error) {
    return handleError(error, 'Failed to simulate COGS')
  }
}

/**
 * Get inventory valuation by method
 */
export const getInventoryValuationByMethod = async () => {
  try {
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    // Use the view created by SQL script
    const { data, error } = await supabase
      .from('vw_stock_valuation_by_method')
      .select('*')
      .eq('tenant_id', tenantId)

    if (error) throw error

    // Group by valuation method
    const byMethod = data.reduce((acc, item) => {
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
      acc[method].items.push(item)
      
      return acc
    }, {})

    const totals = {
      total_items: data.length,
      total_quantity: data.reduce((sum, item) => sum + (item.stock_quantity || 0), 0),
      total_value: data.reduce((sum, item) => sum + (item.stock_value || 0), 0)
    }

    return handleSuccess('Inventory valuation by method retrieved', {
      by_method: Object.values(byMethod),
      totals,
      raw_data: data
    })

  } catch (error) {
    return handleError(error, 'Failed to get inventory valuation by method')
  }
}

export default {
  // Multi-method operations
  recordInventoryMovementV2,
  receivePurchaseV2,
  receiveProductionV2,
  shipSalesV2,
  consumeForManufacturingV2,
  adjustInventoryV2,
  
  // Valuation queries
  getProductBatches,
  simulateCOGS,
  getInventoryValuationByMethod
}
