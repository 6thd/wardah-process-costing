/**
 * Manufacturing Domain Module
 * Business logic for manufacturing operations, BOMs, and work centers
 */

import { getSupabase, getConfig } from '../core/supabaseClient.js'
import { getCurrentTenantId } from '../core/security.js'
import { 
  validateRequired, 
  validatePositiveNumber,
  handleError,
  handleSuccess,
  generateId
} from '../core/utils.js'

// ===================================================================
// WORK CENTERS MANAGEMENT
// ===================================================================

/**
 * Get all work centers for the current tenant
 */
export const getAllWorkCenters = async () => {
  try {
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.work_centers)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('seq')

    if (error) throw error

    return handleSuccess('Work centers retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get work centers')
  }
}

/**
 * Create a new work center
 */
export const createWorkCenter = async ({
  code,
  name,
  nameAr,
  seq,
  costBase = 'labor_hours',
  defaultRate = 0,
  description = null
}) => {
  try {
    // Validation
    validateRequired(code, 'Work Center Code')
    validateRequired(name, 'Work Center Name')
    validatePositiveNumber(seq, 'Sequence Number')
    validatePositiveNumber(defaultRate, 'Default Rate')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    const { data, error } = await supabase
      .from(config.TABLE_NAMES.work_centers)
      .insert({
        code,
        name,
        name_ar: nameAr,
        seq,
        cost_base: costBase,
        default_rate: defaultRate,
        description,
        tenant_id: tenantId,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    return handleSuccess('Work center created successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to create work center')
  }
}

/**
 * Update work center
 */
export const updateWorkCenter = async (id, updates) => {
  try {
    validateRequired(id, 'Work Center ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.work_centers)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) throw error

    return handleSuccess('Work center updated successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to update work center')
  }
}

// ===================================================================
// MANUFACTURING ORDERS MANAGEMENT
// ===================================================================

/**
 * Get all manufacturing orders for the current tenant
 */
export const getAllManufacturingOrders = async () => {
  try {
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.manufacturing_orders)
      .select(`
        *,
        item:items(*),
        bom:boms(*)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return handleSuccess('Manufacturing orders retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get manufacturing orders')
  }
}

/**
 * Get manufacturing order by ID
 */
export const getManufacturingOrderById = async (id) => {
  try {
    validateRequired(id, 'Manufacturing Order ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.manufacturing_orders)
      .select(`
        *,
        item:items(*),
        bom:boms(*),
        stage_costs(
          *,
          work_center:work_centers(*)
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (error) throw error

    return handleSuccess('Manufacturing order retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get manufacturing order')
  }
}

/**
 * Create manufacturing order
 */
export const createManufacturingOrder = async ({
  orderNumber,
  itemId,
  quantity,
  bomId = null,
  plannedStages = 1,
  costingMethod = 'process_costing',
  batchNumber = null,
  startDate = null,
  notes = null
}) => {
  try {
    // Validation
    validateRequired(itemId, 'Item ID')
    validatePositiveNumber(quantity, 'Quantity')
    
    if (!orderNumber) {
      orderNumber = generateId('MO')
    }
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    const { data, error } = await supabase
      .from(config.TABLE_NAMES.manufacturing_orders)
      .insert({
        order_number: orderNumber,
        item_id: itemId,
        quantity,
        bom_id: bomId,
        planned_stages: plannedStages,
        current_stage: 1,
        costing_method: costingMethod,
        batch_number: batchNumber,
        start_date: startDate || new Date().toISOString(),
        status: 'pending',
        total_cost: 0,
        tenant_id: tenantId,
        notes
      })
      .select(`
        *,
        item:items(*),
        bom:boms(*)
      `)
      .single()

    if (error) throw error

    return handleSuccess('Manufacturing order created successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to create manufacturing order')
  }
}

/**
 * Update manufacturing order status
 */
export const updateManufacturingOrderStatus = async (id, status, endDate = null) => {
  try {
    validateRequired(id, 'Manufacturing Order ID')
    validateRequired(status, 'Status')
    
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled']
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`)
    }
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    }
    
    if (status === 'completed' && !endDate) {
      updateData.end_date = new Date().toISOString()
    } else if (endDate) {
      updateData.end_date = endDate
    }

    const { data, error } = await supabase
      .from(config.TABLE_NAMES.manufacturing_orders)
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(`
        *,
        item:items(*),
        bom:boms(*)
      `)
      .single()

    if (error) throw error

    return handleSuccess('Manufacturing order status updated successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to update manufacturing order status')
  }
}

// ===================================================================
// BILL OF MATERIALS (BOM) MANAGEMENT
// ===================================================================

/**
 * Get all BOMs for an item
 */
export const getBOMsForItem = async (itemId) => {
  try {
    validateRequired(itemId, 'Item ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.boms)
      .select(`
        *,
        bom_lines(
          *,
          component_item:items(*),
          work_center:work_centers(*)
        )
      `)
      .eq('parent_item_id', itemId)
      .eq('tenant_id', tenantId)
      .order('effective_date', { ascending: false })

    if (error) throw error

    return handleSuccess('BOMs retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get BOMs')
  }
}

/**
 * Get active BOM for an item
 */
export const getActiveBOMForItem = async (itemId) => {
  try {
    validateRequired(itemId, 'Item ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.boms)
      .select(`
        *,
        bom_lines(
          *,
          component_item:items(*),
          work_center:work_centers(*)
        )
      `)
      .eq('parent_item_id', itemId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('status', 'approved')
      .order('effective_date', { ascending: false })
      .limit(1)
      .single()

    if (error) throw error

    return handleSuccess('Active BOM retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get active BOM')
  }
}

/**
 * Create BOM with lines
 */
export const createBOM = async ({
  parentItemId,
  version = '1.0',
  baseQuantity = 1,
  yieldPercentage = 100,
  effectiveDate = null,
  notes = null,
  bomLines = []
}) => {
  try {
    // Validation
    validateRequired(parentItemId, 'Parent Item ID')
    validatePositiveNumber(baseQuantity, 'Base Quantity')
    validatePositiveNumber(yieldPercentage, 'Yield Percentage')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Create BOM header
    const { data: bomData, error: bomError } = await supabase
      .from(config.TABLE_NAMES.boms)
      .insert({
        parent_item_id: parentItemId,
        version,
        base_quantity: baseQuantity,
        yield_percentage: yieldPercentage,
        effective_date: effectiveDate || new Date().toISOString(),
        status: 'draft',
        notes,
        tenant_id: tenantId,
        is_active: true
      })
      .select()
      .single()

    if (bomError) throw bomError

    // Create BOM lines if provided
    if (bomLines.length > 0) {
      const bomLinesWithId = bomLines.map((line, index) => ({
        ...line,
        bom_id: bomData.id,
        tenant_id: tenantId,
        line_number: index + 1,
        stage_no: line.stage_no || 1
      }))

      const { data: linesData, error: linesError } = await supabase
        .from(config.TABLE_NAMES.bom_lines)
        .insert(bomLinesWithId)
        .select(`
          *,
          component_item:items(*),
          work_center:work_centers(*)
        `)

      if (linesError) throw linesError

      bomData.bom_lines = linesData
    }

    return handleSuccess('BOM created successfully', bomData)

  } catch (error) {
    return handleError(error, 'Failed to create BOM')
  }
}

/**
 * Update BOM status
 */
export const updateBOMStatus = async (bomId, status) => {
  try {
    validateRequired(bomId, 'BOM ID')
    validateRequired(status, 'Status')
    
    const validStatuses = ['draft', 'approved', 'archived']
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`)
    }
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.boms)
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', bomId)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) throw error

    return handleSuccess('BOM status updated successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to update BOM status')
  }
}

// ===================================================================
// MANUFACTURING REPORTS
// ===================================================================

/**
 * Get manufacturing dashboard data
 */
export const getManufacturingDashboard = async () => {
  try {
    const ordersResult = await getAllManufacturingOrders()
    if (!ordersResult.success) {
      throw new Error(ordersResult.error)
    }

    const orders = ordersResult.data
    
    const dashboard = {
      totalOrders: orders.length,
      activeOrders: orders.filter(o => o.status === 'in_progress').length,
      completedOrders: orders.filter(o => o.status === 'completed').length,
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      cancelledOrders: orders.filter(o => o.status === 'cancelled').length,
      totalValue: orders.reduce((sum, o) => sum + (o.total_cost || 0), 0),
      averageOrderValue: 0,
      ordersByStatus: {},
      recentOrders: orders.slice(0, 10)
    }

    // Calculate average
    if (dashboard.totalOrders > 0) {
      dashboard.averageOrderValue = dashboard.totalValue / dashboard.totalOrders
    }

    // Group by status
    dashboard.ordersByStatus = orders.reduce((acc, order) => {
      if (!acc[order.status]) acc[order.status] = 0
      acc[order.status]++
      return acc
    }, {})

    return handleSuccess('Manufacturing dashboard data retrieved successfully', dashboard)

  } catch (error) {
    return handleError(error, 'Failed to get manufacturing dashboard data')
  }
}

export default {
  // Work Centers
  getAllWorkCenters,
  createWorkCenter,
  updateWorkCenter,
  
  // Manufacturing Orders
  getAllManufacturingOrders,
  getManufacturingOrderById,
  createManufacturingOrder,
  updateManufacturingOrderStatus,
  
  // BOMs
  getBOMsForItem,
  getActiveBOMForItem,
  createBOM,
  updateBOMStatus,
  
  // Reports
  getManufacturingDashboard
}