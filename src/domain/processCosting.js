/**
 * Process Costing Domain Module
 * Core business logic for process costing methodology
 * Handles stage cost calculations, labor tracking, and overhead allocation
 */

// Use dynamic imports to avoid circular dependencies
let supabaseClientModule = null
let utilsModule = null

const loadModules = async () => {
  if (!supabaseClientModule) {
    supabaseClientModule = await import('../core/supabaseClient.js')
  }
  if (!utilsModule) {
    utilsModule = await import('../core/utils.js')
  }
}

const getSupabase = () => supabaseClientModule.getSupabase()
const getCurrentTenantId = () => supabaseClientModule.getTenantId()

const validateRequired = (value, fieldName) => utilsModule.validateRequired(value, fieldName)
const validatePositiveNumber = (value, fieldName) => utilsModule.validatePositiveNumber(value, fieldName)
const validateStageNumber = (stageNumber) => utilsModule.validateStageNumber(stageNumber)
const calculateStageCost = (params) => utilsModule.calculateStageCost(params)
const calculateUnitCost = (totalCost, goodQuantity) => utilsModule.calculateUnitCost(totalCost, goodQuantity)
const handleError = (error, context) => utilsModule.handleError(error, context)
const handleSuccess = (message, data) => utilsModule.handleSuccess(message, data)

// Initialize modules when the file is loaded
loadModules().catch(console.error)

// ===================================================================
// CORE PROCESS COSTING OPERATIONS
// ===================================================================

/**
 * Calculate and update stage costs using the standard process costing formula:
 * Total Cost = Transferred In + Direct Materials + Direct Labor + MOH + Regrind - Waste Credit
 * Unit Cost = Total Cost / Good Quantity
 */
export const upsertStageCost = async ({
  moId,
  stageNo,
  workCenterId,
  goodQty,
  directMaterialCost = 0,
  mode = 'precosted',
  scrapQty = 0,
  reworkQty = 0,
  inputQty = null,
  notes = null
}) => {
  try {
    // Validation
    validateRequired(moId, 'Manufacturing Order ID')
    validateStageNumber(stageNo)
    validateRequired(workCenterId, 'Work Center ID')
    validatePositiveNumber(goodQty, 'Good Quantity')
    
    const supabase = getSupabase()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Call the atomic RPC function
    const { data, error } = await supabase.rpc('upsert_stage_cost', {
      p_tenant: tenantId,
      p_mo: moId,
      p_stage: stageNo,
      p_wc: workCenterId,
      p_good_qty: goodQty,
      p_dm: directMaterialCost,
      p_mode: mode,
      p_scrap_qty: scrapQty,
      p_rework_qty: reworkQty,
      p_input_qty: inputQty,
      p_notes: notes
    })

    if (error) throw error

    const result = data[0] || {}
    
    return handleSuccess('Stage cost calculated successfully', {
      stageId: result.stage_id,
      totalCost: result.total_cost,
      unitCost: result.unit_cost,
      transferredIn: result.transferred_in,
      laborCost: result.labor_cost,
      overheadCost: result.overhead_cost
    })

  } catch (error) {
    return handleError(error, 'Failed to calculate stage cost')
  }
}

/**
 * Apply labor time and calculate labor costs for a manufacturing stage
 */
export const applyLaborTime = async ({
  moId,
  stageNo,
  workCenterId,
  hours,
  hourlyRate,
  employeeId = null,
  employeeName = null,
  operationCode = null,
  notes = null
}) => {
  try {
    // Validation
    validateRequired(moId, 'Manufacturing Order ID')
    validateStageNumber(stageNo)
    validateRequired(workCenterId, 'Work Center ID')
    validatePositiveNumber(hours, 'Hours')
    validatePositiveNumber(hourlyRate, 'Hourly Rate')
    
    const supabase = getSupabase()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Call the atomic RPC function
    const { data, error } = await supabase.rpc('apply_labor_time', {
      p_tenant: tenantId,
      p_mo: moId,
      p_stage: stageNo,
      p_wc: workCenterId,
      p_hours: hours,
      p_hourly_rate: hourlyRate,
      p_employee_id: employeeId,
      p_employee_name: employeeName,
      p_operation_code: operationCode,
      p_notes: notes
    })

    if (error) throw error

    return handleSuccess('Labor time applied successfully', {
      logId: data,
      totalLaborCost: hours * hourlyRate,
      hours,
      rate: hourlyRate
    })

  } catch (error) {
    return handleError(error, 'Failed to apply labor time')
  }
}

/**
 * Apply manufacturing overhead using various allocation bases
 */
export const applyOverhead = async ({
  moId,
  stageNo,
  workCenterId,
  allocationBase,
  baseQty,
  overheadRate,
  overheadType = 'variable',
  notes = null
}) => {
  try {
    // Validation
    validateRequired(moId, 'Manufacturing Order ID')
    validateStageNumber(stageNo)
    validateRequired(workCenterId, 'Work Center ID')
    validateRequired(allocationBase, 'Allocation Base')
    validatePositiveNumber(baseQty, 'Base Quantity')
    validatePositiveNumber(overheadRate, 'Overhead Rate')
    
    const validBases = ['labor_hours', 'machine_hours', 'labor_cost', 'material_cost', 'units']
    if (!validBases.includes(allocationBase)) {
      throw new Error(`Invalid allocation base. Must be one of: ${validBases.join(', ')}`)
    }
    
    const supabase = getSupabase()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Call the atomic RPC function
    const { data, error } = await supabase.rpc('apply_overhead', {
      p_tenant: tenantId,
      p_mo: moId,
      p_stage: stageNo,
      p_wc: workCenterId,
      p_allocation_base: allocationBase,
      p_base_qty: baseQty,
      p_overhead_rate: overheadRate,
      p_overhead_type: overheadType,
      p_notes: notes
    })

    if (error) throw error

    return handleSuccess('Overhead applied successfully', {
      mohId: data,
      overheadAmount: baseQty * overheadRate,
      allocationBase,
      baseQty,
      rate: overheadRate
    })

  } catch (error) {
    return handleError(error, 'Failed to apply overhead')
  }
}

/**
 * Consume BOM materials for a manufacturing stage with AVCO inventory impact
 */
export const consumeBOMmaterials = async ({
  moId,
  stageNo,
  consumptionQty,
  bomId = null
}) => {
  try {
    // Validation
    validateRequired(moId, 'Manufacturing Order ID')
    validateStageNumber(stageNo)
    validatePositiveNumber(consumptionQty, 'Consumption Quantity')
    
    const supabase = getSupabase()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Call the atomic RPC function
    const { data, error } = await supabase.rpc('consume_bom_materials', {
      p_tenant: tenantId,
      p_mo: moId,
      p_stage: stageNo,
      p_consumption_qty: consumptionQty,
      p_bom_id: bomId
    })

    if (error) throw error

    const totalMaterialCost = data.reduce((sum, item) => sum + item.total_cost, 0)

    return handleSuccess('BOM materials consumed successfully', {
      consumedItems: data,
      totalMaterialCost,
      consumptionQty
    })

  } catch (error) {
    return handleError(error, 'Failed to consume BOM materials')
  }
}

/**
 * Complete manufacturing order and update finished goods inventory
 */
export const finishManufacturingOrder = async (moId, completedQty) => {
  try {
    // Validation
    validateRequired(moId, 'Manufacturing Order ID')
    validatePositiveNumber(completedQty, 'Completed Quantity')
    
    const supabase = getSupabase()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Call the atomic RPC function
    const { data, error } = await supabase.rpc('finish_manufacturing_order', {
      p_tenant: tenantId,
      p_mo: moId,
      p_completed_qty: completedQty
    })

    if (error) throw error

    const result = data[0] || {}

    return handleSuccess('Manufacturing order completed successfully', {
      moId: result.mo_id,
      finalUnitCost: result.final_unit_cost,
      totalProductionCost: result.total_production_cost,
      inventoryValueAdded: result.inventory_value_added,
      completedQty
    })

  } catch (error) {
    return handleError(error, 'Failed to finish manufacturing order')
  }
}

// ===================================================================
// QUERY OPERATIONS
// ===================================================================

/**
 * Get stage costs for a manufacturing order
 */
export const getStageCosts = async (moId) => {
  try {
    validateRequired(moId, 'Manufacturing Order ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    const { data, error } = await supabase
      .from(config.TABLE_NAMES.stage_costs)
      .select(`
        *,
        work_center:work_centers(*)
      `)
      .eq('mo_id', moId)
      .eq('tenant_id', tenantId)
      .order('stage_no')

    if (error) throw error

    return handleSuccess('Stage costs retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get stage costs')
  }
}

/**
 * Get labor time logs for a manufacturing order
 */
export const getLaborTimeLogs = async (moId, stageNo = null) => {
  try {
    validateRequired(moId, 'Manufacturing Order ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    let query = supabase
      .from(config.TABLE_NAMES.labor_time_logs)
      .select(`
        *,
        work_center:work_centers(*)
      `)
      .eq('mo_id', moId)
      .eq('tenant_id', tenantId)

    if (stageNo) {
      query = query.eq('stage_no', stageNo)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error

    return handleSuccess('Labor time logs retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get labor time logs')
  }
}

/**
 * Get overhead applications for a manufacturing order
 */
export const getOverheadApplications = async (moId, stageNo = null) => {
  try {
    validateRequired(moId, 'Manufacturing Order ID')
    
    const supabase = getSupabase()
    const config = getConfig()
    const tenantId = await getCurrentTenantId()
    
    let query = supabase
      .from(config.TABLE_NAMES.moh_applied)
      .select(`
        *,
        work_center:work_centers(*)
      `)
      .eq('mo_id', moId)
      .eq('tenant_id', tenantId)

    if (stageNo) {
      query = query.eq('stage_no', stageNo)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error

    return handleSuccess('Overhead applications retrieved successfully', data)

  } catch (error) {
    return handleError(error, 'Failed to get overhead applications')
  }
}

/**
 * Get complete stage cost report for a manufacturing order
 */
export const getStageCostReport = async (moId) => {
  try {
    validateRequired(moId, 'Manufacturing Order ID')
    
    const stageCostsResult = await getStageCosts(moId)
    if (!stageCostsResult.success) {
      throw new Error(stageCostsResult.error)
    }

    const laborResult = await getLaborTimeLogs(moId)
    const overheadResult = await getOverheadApplications(moId)

    const stageCosts = stageCostsResult.data
    const laborLogs = laborResult.data || []
    const overheadApps = overheadResult.data || []

    // Group labor and overhead by stage
    const laborByStage = laborLogs.reduce((acc, log) => {
      if (!acc[log.stage_no]) acc[log.stage_no] = []
      acc[log.stage_no].push(log)
      return acc
    }, {})

    const overheadByStage = overheadApps.reduce((acc, app) => {
      if (!acc[app.stage_no]) acc[app.stage_no] = []
      acc[app.stage_no].push(app)
      return acc
    }, {})

    // Combine data for comprehensive report
    const report = stageCosts.map(stage => ({
      ...stage,
      laborDetails: laborByStage[stage.stage_no] || [],
      overheadDetails: overheadByStage[stage.stage_no] || [],
      laborCount: (laborByStage[stage.stage_no] || []).length,
      overheadCount: (overheadByStage[stage.stage_no] || []).length
    }))

    // Calculate totals
    const totals = {
      totalStages: report.length,
      totalCost: report.reduce((sum, stage) => sum + stage.total_cost, 0),
      totalTransferredIn: report.reduce((sum, stage) => sum + stage.transferred_in, 0),
      totalDirectMaterials: report.reduce((sum, stage) => sum + stage.dm_cost, 0),
      totalDirectLabor: report.reduce((sum, stage) => sum + stage.dl_cost, 0),
      totalOverhead: report.reduce((sum, stage) => sum + stage.moh_cost, 0),
      totalGoodQty: report.reduce((sum, stage) => sum + stage.good_qty, 0),
      averageUnitCost: 0
    }

    if (totals.totalGoodQty > 0) {
      totals.averageUnitCost = totals.totalCost / totals.totalGoodQty
    }

    return handleSuccess('Stage cost report generated successfully', {
      stages: report,
      totals,
      generatedAt: new Date().toISOString()
    })

  } catch (error) {
    return handleError(error, 'Failed to generate stage cost report')
  }
}

/**
 * Recalculate all stage costs for a manufacturing order
 */
export const recalculateAllStageCosts = async (moId) => {
  try {
    validateRequired(moId, 'Manufacturing Order ID')
    
    const supabase = getSupabase()
    const tenantId = await getCurrentTenantId()
    
    if (!tenantId) {
      throw new Error('No tenant context available')
    }

    // Call the recalculation RPC function
    const { data, error } = await supabase.rpc('recalculate_mo_costs', {
      p_tenant: tenantId,
      p_mo: moId
    })

    if (error) throw error

    return handleSuccess(`Recalculated ${data} stage costs successfully`, {
      moId,
      stagesRecalculated: data
    })

  } catch (error) {
    return handleError(error, 'Failed to recalculate stage costs')
  }
}

export default {
  upsertStageCost,
  applyLaborTime,
  applyOverhead,
  consumeBOMmaterials,
  finishManufacturingOrder,
  getStageCosts,
  getLaborTimeLogs,
  getOverheadApplications,
  getStageCostReport,
  recalculateAllStageCosts
}