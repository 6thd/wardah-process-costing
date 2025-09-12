/**
 * Audit Trail Domain Module
 * Comprehensive audit logging and trail management
 * Tracks all system changes and business operations
 */

import { getSupabase, getConfig } from '../core/supabaseClient.js'
import { getCurrentTenantId, getCurrentUserWithTenant } from '../core/security.js'
import { 
  validateRequired, 
  handleError,
  handleSuccess,
  formatDateTime
} from '../core/utils.js'

// ===================================================================
// AUDIT LOGGING OPERATIONS
// ===================================================================

/**
 * Log an audit event
 */
export const logAuditEvent = async ({
  eventType,
  tableName,
  recordId = null,
  operation = null,
  oldValues = null,
  newValues = null,
  changedFields = null,
  sourceIp = null,
  userAgent = null
}) => {
  try {
    // Validation
    validateRequired(eventType, 'Event Type')
    validateRequired(tableName, 'Table Name')
    
    const validEventTypes = ['CREATE', 'UPDATE', 'DELETE', 'PROCESS', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT']
    if (!validEventTypes.includes(eventType)) {
      throw new Error(`Invalid event type. Must be one of: ${validEventTypes.join(', ')}`)
    }
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    const user = await getCurrentUserWithTenant()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Prepare audit data
    const auditData = {
      tenant_id: tenantId,
      event_type: eventType,
      table_name: tableName,
      record_id: recordId,
      operation: operation,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      changed_fields: changedFields,
      source_ip: sourceIp,
      user_agent: userAgent,
      user_id: user?.id || null,
      user_email: user?.email || null,
      occurred_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from(config.TABLE_NAMES.audit_trail)
      .insert(auditData)
      .select()
      .single()

    if (error) throw error

    return handleSuccess('Audit event logged successfully', data)

  } catch (error) {
    // Don't throw error for audit logging failures to avoid breaking main operations
    console.error('Failed to log audit event:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Log process costing operation
 */
export const logProcessCostingOperation = async ({
  operation,
  moId,
  stageNo = null,
  details = {},
  oldValues = null,
  newValues = null
}) => {
  try {
    return await logAuditEvent({
      eventType: 'PROCESS',
      tableName: 'stage_costs',
      recordId: moId,
      operation: `process_costing_${operation}`,
      oldValues,
      newValues: {
        ...newValues,
        mo_id: moId,
        stage_no: stageNo,
        operation_details: details
      }
    })

  } catch (error) {
    return handleError(error, 'Failed to log process costing operation')
  }
}

/**
 * Log inventory operation
 */
export const logInventoryOperation = async ({
  operation,
  itemId,
  movementType,
  quantity,
  unitCost = null,
  oldStock = null,
  newStock = null,
  refId = null
}) => {
  try {
    return await logAuditEvent({
      eventType: 'UPDATE',
      tableName: 'inventory_ledger',
      recordId: itemId,
      operation: `inventory_${operation}`,
      oldValues: oldStock !== null ? { stock_quantity: oldStock } : null,
      newValues: {
        item_id: itemId,
        movement_type: movementType,
        quantity,
        unit_cost: unitCost,
        new_stock: newStock,
        reference_id: refId
      }
    })

  } catch (error) {
    return handleError(error, 'Failed to log inventory operation')
  }
}

/**
 * Log manufacturing operation
 */
export const logManufacturingOperation = async ({
  operation,
  moId,
  oldStatus = null,
  newStatus = null,
  additionalData = {}
}) => {
  try {
    return await logAuditEvent({
      eventType: oldStatus && newStatus ? 'UPDATE' : 'PROCESS',
      tableName: 'manufacturing_orders',
      recordId: moId,
      operation: `manufacturing_${operation}`,
      oldValues: oldStatus ? { status: oldStatus } : null,
      newValues: {
        mo_id: moId,
        status: newStatus,
        ...additionalData
      }
    })

  } catch (error) {
    return handleError(error, 'Failed to log manufacturing operation')
  }
}

// ===================================================================
// AUDIT QUERIES AND REPORTS
// ===================================================================

/**
 * Get audit trail for a specific record
 */
export const getAuditTrailForRecord = async (tableName, recordId, limit = 50) => {
  try {
    validateRequired(tableName, 'Table Name')
    validateRequired(recordId, 'Record ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.audit_trail)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('table_name', tableName)
      .eq('record_id', recordId)
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    // Parse JSON fields
    const parsedData = data.map(entry => ({
      ...entry,
      old_values: entry.old_values ? JSON.parse(entry.old_values) : null,
      new_values: entry.new_values ? JSON.parse(entry.new_values) : null,
      occurred_at_formatted: formatDateTime(entry.occurred_at)
    }))

    return handleSuccess('Audit trail retrieved successfully', parsedData)

  } catch (error) {
    return handleError(error, 'Failed to get audit trail for record')
  }
}

/**
 * Get audit trail by user
 */
export const getAuditTrailByUser = async (userId, fromDate = null, toDate = null, limit = 100) => {
  try {
    validateRequired(userId, 'User ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    let query = supabase
      .from(config.TABLE_NAMES.audit_trail)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)

    if (fromDate) {
      query = query.gte('occurred_at', fromDate)
    }
    
    if (toDate) {
      query = query.lte('occurred_at', toDate)
    }

    const { data, error } = await query
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    // Parse JSON fields and group by operation
    const parsedData = data.map(entry => ({
      ...entry,
      old_values: entry.old_values ? JSON.parse(entry.old_values) : null,
      new_values: entry.new_values ? JSON.parse(entry.new_values) : null,
      occurred_at_formatted: formatDateTime(entry.occurred_at)
    }))

    // Group by event type for summary
    const summary = parsedData.reduce((acc, entry) => {
      const eventType = entry.event_type
      if (!acc[eventType]) {
        acc[eventType] = { count: 0, latest: null }
      }
      acc[eventType].count++
      if (!acc[eventType].latest || entry.occurred_at > acc[eventType].latest) {
        acc[eventType].latest = entry.occurred_at
      }
      return acc
    }, {})

    return handleSuccess('User audit trail retrieved successfully', {
      entries: parsedData,
      summary,
      user_id: userId,
      period: { from: fromDate, to: toDate }
    })

  } catch (error) {
    return handleError(error, 'Failed to get user audit trail')
  }
}

/**
 * Get audit trail by operation type
 */
export const getAuditTrailByOperation = async (operation, fromDate = null, toDate = null, limit = 100) => {
  try {
    validateRequired(operation, 'Operation')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    let query = supabase
      .from(config.TABLE_NAMES.audit_trail)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('operation', operation)

    if (fromDate) {
      query = query.gte('occurred_at', fromDate)
    }
    
    if (toDate) {
      query = query.lte('occurred_at', toDate)
    }

    const { data, error } = await query
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    // Parse JSON fields
    const parsedData = data.map(entry => ({
      ...entry,
      old_values: entry.old_values ? JSON.parse(entry.old_values) : null,
      new_values: entry.new_values ? JSON.parse(entry.new_values) : null,
      occurred_at_formatted: formatDateTime(entry.occurred_at)
    }))

    return handleSuccess('Operation audit trail retrieved successfully', {
      entries: parsedData,
      operation,
      count: parsedData.length,
      period: { from: fromDate, to: toDate }
    })

  } catch (error) {
    return handleError(error, 'Failed to get operation audit trail')
  }
}

/**
 * Get audit summary dashboard
 */
export const getAuditSummary = async (fromDate = null, toDate = null) => {
  try {
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    // Default to last 30 days if no dates provided
    if (!fromDate) {
      fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    }
    if (!toDate) {
      toDate = new Date().toISOString()
    }
    
    let query = supabase
      .from(config.TABLE_NAMES.audit_trail)
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('occurred_at', fromDate)
      .lte('occurred_at', toDate)

    const { data, error } = await query

    if (error) throw error

    // Calculate summary statistics
    const summary = {
      total_events: data.length,
      by_event_type: {},
      by_table: {},
      by_user: {},
      by_operation: {},
      date_range: { from: fromDate, to: toDate },
      most_active_users: [],
      most_modified_tables: [],
      recent_activities: []
    }

    // Group by various dimensions
    data.forEach(entry => {
      // By event type
      if (!summary.by_event_type[entry.event_type]) {
        summary.by_event_type[entry.event_type] = 0
      }
      summary.by_event_type[entry.event_type]++

      // By table
      if (!summary.by_table[entry.table_name]) {
        summary.by_table[entry.table_name] = 0
      }
      summary.by_table[entry.table_name]++

      // By user
      if (entry.user_email) {
        if (!summary.by_user[entry.user_email]) {
          summary.by_user[entry.user_email] = 0
        }
        summary.by_user[entry.user_email]++
      }

      // By operation
      if (entry.operation) {
        if (!summary.by_operation[entry.operation]) {
          summary.by_operation[entry.operation] = 0
        }
        summary.by_operation[entry.operation]++
      }
    })

    // Get top users and tables
    summary.most_active_users = Object.entries(summary.by_user)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([user, count]) => ({ user, count }))

    summary.most_modified_tables = Object.entries(summary.by_table)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([table, count]) => ({ table, count }))

    // Get recent activities (last 10)
    summary.recent_activities = data
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
      .slice(0, 10)
      .map(entry => ({
        ...entry,
        old_values: entry.old_values ? JSON.parse(entry.old_values) : null,
        new_values: entry.new_values ? JSON.parse(entry.new_values) : null,
        occurred_at_formatted: formatDateTime(entry.occurred_at)
      }))

    return handleSuccess('Audit summary retrieved successfully', summary)

  } catch (error) {
    return handleError(error, 'Failed to get audit summary')
  }
}

/**
 * Export audit trail data
 */
export const exportAuditTrail = async (filters = {}, format = 'json') => {
  try {
    const { 
      fromDate, 
      toDate, 
      eventType, 
      tableName, 
      userId, 
      operation,
      limit = 1000 
    } = filters
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    let query = supabase
      .from(config.TABLE_NAMES.audit_trail)
      .select('*')
      .eq('tenant_id', tenantId)

    // Apply filters
    if (fromDate) query = query.gte('occurred_at', fromDate)
    if (toDate) query = query.lte('occurred_at', toDate)
    if (eventType) query = query.eq('event_type', eventType)
    if (tableName) query = query.eq('table_name', tableName)
    if (userId) query = query.eq('user_id', userId)
    if (operation) query = query.eq('operation', operation)

    const { data, error } = await query
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    // Parse JSON fields for export
    const exportData = data.map(entry => ({
      ...entry,
      old_values: entry.old_values ? JSON.parse(entry.old_values) : null,
      new_values: entry.new_values ? JSON.parse(entry.new_values) : null
    }))

    // Log export activity
    await logAuditEvent({
      eventType: 'EXPORT',
      tableName: 'audit_trail',
      operation: 'export_audit_trail',
      newValues: {
        filters,
        format,
        record_count: exportData.length
      }
    })

    return handleSuccess('Audit trail exported successfully', {
      data: exportData,
      format,
      filters,
      record_count: exportData.length,
      exported_at: new Date().toISOString()
    })

  } catch (error) {
    return handleError(error, 'Failed to export audit trail')
  }
}

export default {
  // Logging operations
  logAuditEvent,
  logProcessCostingOperation,
  logInventoryOperation,
  logManufacturingOperation,
  
  // Query operations
  getAuditTrailForRecord,
  getAuditTrailByUser,
  getAuditTrailByOperation,
  getAuditSummary,
  exportAuditTrail
}