/**
 * Inventory Domain Module
 * AVCO (Average Cost) inventory valuation system
 * Handles stock movements, cost calculations, and ledger management
 */

import { getSupabase, getConfig } from '../core/supabaseClient.js'
import { getCurrentTenantId } from '../core/security.js'
import { 
  validateRequired, 
  validatePositiveNumber,
  calculateAVCO,
  handleError,
  handleSuccess,
  formatCurrency,
  formatQuantity
} from '../core/utils.js'

// ===================================================================
// AVCO INVENTORY CALCULATIONS
// ===================================================================

/**
 * Calculate AVCO unit cost for an item after a stock movement
 */
const calculateNewAVCO = (currentStock, currentUnitCost, incomingQty, incomingUnitCost) => {
  const currentValue = currentStock * currentUnitCost
  const incomingValue = incomingQty * incomingUnitCost
  
  const newTotalQty = currentStock + incomingQty
  const newTotalValue = currentValue + incomingValue
  
  if (newTotalQty <= 0) {
    return { newUnitCost: 0, newTotalValue: 0, newTotalQty: 0 }
  }
  
  const newUnitCost = newTotalValue / newTotalQty
  
  return {
    newUnitCost: Math.max(0, newUnitCost),
    newTotalValue: Math.max(0, newTotalValue),
    newTotalQty: Math.max(0, newTotalQty)
  }
}

/**
 * Record inventory movement with AVCO impact
 */
export const recordInventoryMovement = async ({
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

    // Get current item stock and cost
    const { data: itemData, error: itemError } = await supabase
      .from(config.TABLE_NAMES.items)
      .select('stock_quantity, cost_price')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .single()

    if (itemError) throw itemError

    const currentStock = itemData.stock_quantity || 0
    const currentUnitCost = itemData.cost_price || 0
    
    let newStock = currentStock
    let newUnitCost = currentUnitCost
    let totalCost = 0

    // Calculate new values based on movement type
    if (qtyIn > 0) {
      // Incoming stock - calculate new AVCO
      const avcoResult = calculateNewAVCO(currentStock, currentUnitCost, qtyIn, unitCost)
      newStock = avcoResult.newTotalQty
      newUnitCost = avcoResult.newUnitCost
      totalCost = qtyIn * unitCost
    } else if (qtyOut > 0) {
      // Outgoing stock - use current AVCO cost
      if (currentStock < qtyOut) {
        throw new Error(`Insufficient stock. Available: ${currentStock}, Required: ${qtyOut}`)
      }
      newStock = currentStock - qtyOut
      newUnitCost = currentUnitCost // AVCO remains same for outgoing
      totalCost = -(qtyOut * currentUnitCost) // Negative for outgoing
    }

    // Calculate running values for ledger
    const runningBalance = newStock
    const runningValue = newStock * newUnitCost
    const avgUnitCost = newUnitCost

    // Begin transaction
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
        unit_cost: qtyIn > 0 ? unitCost : currentUnitCost,
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

    // Update item stock and cost if requested
    if (updateItemStock) {
      const { error: updateError } = await supabase
        .from(config.TABLE_NAMES.items)
        .update({
          stock_quantity: newStock,
          cost_price: newUnitCost,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .eq('tenant_id', tenantId)

      if (updateError) throw updateError
    }

    return handleSuccess('Inventory movement recorded successfully', {
      ledgerEntry: ledgerData,
      stockBefore: currentStock,
      stockAfter: newStock,
      costBefore: currentUnitCost,
      costAfter: newUnitCost,
      totalCostImpact: totalCost
    })

  } catch (error) {
    return handleError(error, 'Failed to record inventory movement')
  }
}

// ===================================================================
// INVENTORY OPERATIONS
// ===================================================================

/**
 * Purchase receipt - add inventory with purchase cost
 */
export const receivePurchase = async ({
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

    return await recordInventoryMovement({
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
export const receiveProduction = async ({
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

    return await recordInventoryMovement({
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
 * Sales shipment - reduce inventory for sales
 */
export const shipSales = async ({
  itemId,
  quantity,
  salesOrderId = null,
  notes = null
}) => {
  try {
    validatePositiveNumber(quantity, 'Quantity')

    return await recordInventoryMovement({
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
export const consumeForManufacturing = async ({
  itemId,
  quantity,
  manufacturingOrderId,
  stageNumber = null,
  notes = null
}) => {
  try {
    validatePositiveNumber(quantity, 'Quantity')

    return await recordInventoryMovement({
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
export const adjustInventory = async ({
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

    return await recordInventoryMovement({
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
// INVENTORY QUERIES AND REPORTS
// ===================================================================

/**
 * Get inventory ledger for an item
 */
export const getInventoryLedger = async (itemId, limit = 100) => {
  try {
    validateRequired(itemId, 'Item ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.inventory_ledger)
      .select(`
        *,
        item:items(*)
      `)
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId)
      .order('moved_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    return handleSuccess('Inventory ledger retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get inventory ledger')
  }
}

/**
 * Get inventory valuation (AVCO)
 */
export const getInventoryValuation = async () => {
  try {
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.items)
      .select('*')
      .eq('tenant_id', tenantId)
      .gt('stock_quantity', 0)
      .order('name')

    if (error) throw error

    // Calculate valuation metrics
    const valuation = data.map(item => {
      const inventoryValue = item.stock_quantity * item.cost_price
      const potentialSalesValue = item.stock_quantity * item.selling_price
      const potentialProfit = potentialSalesValue - inventoryValue
      
      return {
        ...item,
        inventory_value: inventoryValue,
        potential_sales_value: potentialSalesValue,
        potential_profit: potentialProfit,
        margin_percentage: potentialSalesValue > 0 ? (potentialProfit / potentialSalesValue) * 100 : 0
      }
    })

    // Calculate totals
    const totals = {
      total_items: valuation.length,
      total_inventory_value: valuation.reduce((sum, item) => sum + item.inventory_value, 0),
      total_potential_sales: valuation.reduce((sum, item) => sum + item.potential_sales_value, 0),
      total_potential_profit: valuation.reduce((sum, item) => sum + item.potential_profit, 0),
      average_margin: 0
    }

    if (totals.total_potential_sales > 0) {
      totals.average_margin = (totals.total_potential_profit / totals.total_potential_sales) * 100
    }

    return handleSuccess('Inventory valuation retrieved successfully', {
      items: valuation,
      totals,
      valuation_date: new Date().toISOString()
    })

  } catch (error) {
    return handleError(error, 'Failed to get inventory valuation')
  }
}

/**
 * Get low stock items
 */
export const getLowStockItems = async () => {
  try {
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.items)
      .select('*')
      .eq('tenant_id', tenantId)
      .or('stock_quantity.lte.minimum_stock,stock_quantity.eq.0')
      .order('stock_quantity')

    if (error) throw error

    const lowStockItems = data.map(item => ({
      ...item,
      stock_status: item.stock_quantity === 0 ? 'out_of_stock' : 
                   item.stock_quantity <= item.minimum_stock ? 'low_stock' : 'normal',
      shortage_qty: Math.max(0, item.minimum_stock - item.stock_quantity),
      reorder_value: Math.max(0, item.minimum_stock - item.stock_quantity) * item.cost_price
    }))

    return handleSuccess('Low stock items retrieved successfully', lowStockItems)

  } catch (error) {
    return handleError(error, 'Failed to get low stock items')
  }
}

/**
 * Get inventory movement summary by date range
 */
export const getInventoryMovementSummary = async (fromDate, toDate) => {
  try {
    validateRequired(fromDate, 'From Date')
    validateRequired(toDate, 'To Date')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.inventory_ledger)
      .select(`
        move_type,
        qty_in,
        qty_out,
        total_cost,
        moved_at,
        item:items(name, code)
      `)
      .eq('tenant_id', tenantId)
      .gte('moved_at', fromDate)
      .lte('moved_at', toDate)
      .order('moved_at', { ascending: false })

    if (error) throw error

    // Group by movement type
    const summary = data.reduce((acc, movement) => {
      const type = movement.move_type
      if (!acc[type]) {
        acc[type] = {
          move_type: type,
          total_qty_in: 0,
          total_qty_out: 0,
          total_value_in: 0,
          total_value_out: 0,
          movement_count: 0
        }
      }
      
      acc[type].total_qty_in += movement.qty_in || 0
      acc[type].total_qty_out += movement.qty_out || 0
      acc[type].total_value_in += movement.total_cost > 0 ? movement.total_cost : 0
      acc[type].total_value_out += movement.total_cost < 0 ? Math.abs(movement.total_cost) : 0
      acc[type].movement_count++
      
      return acc
    }, {})

    // Calculate overall totals
    const overallTotals = Object.values(summary).reduce((totals, typeData) => {
      totals.total_movements += typeData.movement_count
      totals.total_value_in += typeData.total_value_in
      totals.total_value_out += typeData.total_value_out
      return totals
    }, { total_movements: 0, total_value_in: 0, total_value_out: 0 })

    return handleSuccess('Inventory movement summary retrieved successfully', {
      by_movement_type: Object.values(summary),
      overall_totals: overallTotals,
      period: { from: fromDate, to: toDate },
      raw_movements: data
    })

  } catch (error) {
    return handleError(error, 'Failed to get inventory movement summary')
  }
}

/**
 * Get cost of goods sold (COGS) for a period
 */
export const getCOGSReport = async (fromDate, toDate) => {
  try {
    validateRequired(fromDate, 'From Date')
    validateRequired(toDate, 'To Date')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    // Get all outbound movements (sales, consumption, etc.)
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.inventory_ledger)
      .select(`
        *,
        item:items(name, code, category_name:category)
      `)
      .eq('tenant_id', tenantId)
      .gte('moved_at', fromDate)
      .lte('moved_at', toDate)
      .gt('qty_out', 0)
      .order('moved_at', { ascending: false })

    if (error) throw error

    // Calculate COGS by category and item
    const cogsByItem = data.reduce((acc, movement) => {
      const itemId = movement.item_id
      const itemName = movement.item?.name || 'Unknown'
      const categoryName = movement.item?.category_name || 'Uncategorized'
      
      if (!acc[itemId]) {
        acc[itemId] = {
          item_id: itemId,
          item_name: itemName,
          item_code: movement.item?.code || '',
          category: categoryName,
          total_qty_sold: 0,
          total_cogs: 0,
          average_cost: 0,
          movements: []
        }
      }
      
      acc[itemId].total_qty_sold += movement.qty_out
      acc[itemId].total_cogs += Math.abs(movement.total_cost)
      acc[itemId].movements.push(movement)
      
      return acc
    }, {})

    // Calculate average costs
    Object.values(cogsByItem).forEach(item => {
      if (item.total_qty_sold > 0) {
        item.average_cost = item.total_cogs / item.total_qty_sold
      }
    })

    // Group by category
    const cogsByCategory = Object.values(cogsByItem).reduce((acc, item) => {
      const category = item.category
      if (!acc[category]) {
        acc[category] = {
          category_name: category,
          total_cogs: 0,
          items_count: 0,
          items: []
        }
      }
      
      acc[category].total_cogs += item.total_cogs
      acc[category].items_count++
      acc[category].items.push(item)
      
      return acc
    }, {})

    // Calculate overall totals
    const totalCOGS = Object.values(cogsByItem).reduce((sum, item) => sum + item.total_cogs, 0)
    const totalQtySold = Object.values(cogsByItem).reduce((sum, item) => sum + item.total_qty_sold, 0)

    return handleSuccess('COGS report generated successfully', {
      by_item: Object.values(cogsByItem),
      by_category: Object.values(cogsByCategory),
      totals: {
        total_cogs: totalCOGS,
        total_qty_sold: totalQtySold,
        average_cost: totalQtySold > 0 ? totalCOGS / totalQtySold : 0
      },
      period: { from: fromDate, to: toDate }
    })

  } catch (error) {
    return handleError(error, 'Failed to generate COGS report')
  }
}

export default {
  // Core AVCO operations
  recordInventoryMovement,
  
  // Specific operations
  receivePurchase,
  receiveProduction,
  shipSales,
  consumeForManufacturing,
  adjustInventory,
  
  // Queries and reports
  getInventoryLedger,
  getInventoryValuation,
  getLowStockItems,
  getInventoryMovementSummary,
  getCOGSReport
}