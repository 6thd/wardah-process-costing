/**
 * Efficiency Service - خدمة تقارير الكفاءة
 * إدارة تقارير الكفاءة والأداء و OEE
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase'

// =====================================================
// Types & Interfaces
// =====================================================

export interface LaborEfficiency {
  org_id: string
  work_center_id: string
  work_center_name: string
  order_number: string
  work_order_number: string
  operation_name: string
  planned_setup_time: number
  actual_setup_time: number
  planned_run_time: number
  actual_run_time: number
  planned_quantity: number
  completed_quantity: number
  scrapped_quantity: number
  setup_efficiency_pct: number
  run_efficiency_pct: number
  overall_efficiency_pct: number
  scrap_rate_pct: number
  actual_start_date?: string
  actual_end_date?: string
  status: string
}

export interface WorkCenterEfficiencySummary {
  org_id: string
  work_center_id: string
  work_center_name: string
  work_center_name_ar?: string
  production_date: string
  completed_operations: number
  total_produced: number
  total_scrapped: number
  total_planned_setup: number
  total_actual_setup: number
  total_planned_run: number
  total_actual_run: number
  avg_setup_efficiency: number
  avg_run_efficiency: number
  avg_overall_efficiency: number
}

export interface CostVariance {
  org_id: string
  order_number: string
  work_order_number: string
  operation_name: string
  work_center_name: string
  planned_labor_cost: number
  actual_labor_cost: number
  labor_variance: number
  planned_overhead_cost: number
  actual_overhead_cost: number
  overhead_variance: number
  status: string
  actual_end_date?: string
}

export interface MaterialConsumptionReport {
  org_id: string
  order_number: string
  work_order_number: string
  item_code: string
  item_name: string
  planned_quantity: number
  consumed_quantity: number
  variance_qty: number
  variance_pct: number
  unit_cost: number
  total_cost: number
  consumption_type: string
  consumption_date: string
  status: string
}

export interface OEEReport {
  org_id: string
  work_center_id: string
  work_center_name: string
  production_date: string
  available_time: number
  operating_time: number
  downtime: number
  total_produced: number
  good_quantity: number
  availability_pct: number
  performance_pct: number
  quality_pct: number
  oee_pct: number
}

export interface EfficiencySummary {
  work_center_id: string
  work_center_name: string
  completed_operations: number
  total_planned_time: number
  total_actual_time: number
  efficiency_pct: number
  total_produced: number
  total_scrapped: number
  scrap_rate_pct: number
}

export interface OEESummary {
  work_center_id: string
  work_center_name: string
  availability_pct: number
  performance_pct: number
  quality_pct: number
  oee_pct: number
}

// =====================================================
// Labor Efficiency Reports
// =====================================================

/**
 * الحصول على تقرير كفاءة العمالة
 */
export async function getLaborEfficiencyReport(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}): Promise<LaborEfficiency[]> {
  const orgId = await getEffectiveTenantId()
  
  let query = supabase
    .from('v_labor_efficiency')
    .select('*')
    .eq('org_id', orgId)
  
  if (filters?.workCenterId) {
    query = query.eq('work_center_id', filters.workCenterId)
  }
  if (filters?.fromDate) {
    query = query.gte('actual_end_date', filters.fromDate)
  }
  if (filters?.toDate) {
    query = query.lte('actual_end_date', filters.toDate)
  }
  
  const { data, error } = await query.order('actual_end_date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على ملخص كفاءة مركز العمل اليومي
 */
export async function getWorkCenterEfficiencySummary(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}): Promise<WorkCenterEfficiencySummary[]> {
  const orgId = await getEffectiveTenantId()
  
  let query = supabase
    .from('v_work_center_efficiency_summary')
    .select('*')
    .eq('org_id', orgId)
  
  if (filters?.workCenterId) {
    query = query.eq('work_center_id', filters.workCenterId)
  }
  if (filters?.fromDate) {
    query = query.gte('production_date', filters.fromDate)
  }
  if (filters?.toDate) {
    query = query.lte('production_date', filters.toDate)
  }
  
  const { data, error } = await query.order('production_date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على ملخص الكفاءة باستخدام الدالة
 */
export async function getEfficiencySummary(
  startDate: string,
  endDate: string,
  workCenterId?: string
): Promise<EfficiencySummary[]> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .rpc('get_labor_efficiency_summary', {
      p_org_id: orgId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_work_center_id: workCenterId
    })
  
  if (error) throw error
  return data || []
}

// =====================================================
// Cost Variance Reports
// =====================================================

/**
 * الحصول على تقرير تباين التكاليف
 */
export async function getCostVarianceReport(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}): Promise<CostVariance[]> {
  const orgId = await getEffectiveTenantId()
  
  let query = supabase
    .from('v_cost_variance_report')
    .select('*')
    .eq('org_id', orgId)
  
  if (filters?.workCenterId) {
    query = query.eq('work_center_id', filters.workCenterId)
  }
  if (filters?.fromDate) {
    query = query.gte('actual_end_date', filters.fromDate)
  }
  if (filters?.toDate) {
    query = query.lte('actual_end_date', filters.toDate)
  }
  
  const { data, error } = await query.order('actual_end_date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * حساب إجمالي التباينات
 */
export async function getTotalVariances(
  startDate: string,
  endDate: string
): Promise<{
  total_labor_variance: number
  total_overhead_variance: number
  total_variance: number
  favorable_count: number
  unfavorable_count: number
}> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('v_cost_variance_report')
    .select('labor_variance, overhead_variance')
    .eq('org_id', orgId)
    .gte('actual_end_date', startDate)
    .lte('actual_end_date', endDate)
  
  if (error) throw error
  
  const records = data || []
  let totalLaborVariance = 0
  let totalOverheadVariance = 0
  let favorableCount = 0
  let unfavorableCount = 0
  
  records.forEach(r => {
    totalLaborVariance += r.labor_variance || 0
    totalOverheadVariance += r.overhead_variance || 0
    
    const totalVar = (r.labor_variance || 0) + (r.overhead_variance || 0)
    if (totalVar < 0) favorableCount++
    else if (totalVar > 0) unfavorableCount++
  })
  
  return {
    total_labor_variance: totalLaborVariance,
    total_overhead_variance: totalOverheadVariance,
    total_variance: totalLaborVariance + totalOverheadVariance,
    favorable_count: favorableCount,
    unfavorable_count: unfavorableCount
  }
}

// =====================================================
// Material Consumption Reports
// =====================================================

/**
 * الحصول على تقرير استهلاك المواد
 */
export async function getMaterialConsumptionReport(filters?: {
  moId?: string
  itemId?: string
  fromDate?: string
  toDate?: string
}): Promise<MaterialConsumptionReport[]> {
  const orgId = await getEffectiveTenantId()
  
  let query = supabase
    .from('v_material_consumption_report')
    .select('*')
    .eq('org_id', orgId)
  
  if (filters?.moId) {
    // Need to filter by mo_id through order_number
  }
  if (filters?.itemId) {
    query = query.eq('item_id', filters.itemId)
  }
  if (filters?.fromDate) {
    query = query.gte('consumption_date', filters.fromDate)
  }
  if (filters?.toDate) {
    query = query.lte('consumption_date', filters.toDate)
  }
  
  const { data, error } = await query.order('consumption_date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * حساب إجمالي استهلاك المواد
 */
export async function getTotalMaterialConsumption(
  startDate: string,
  endDate: string
): Promise<{
  total_planned_qty: number
  total_consumed_qty: number
  total_variance_qty: number
  total_cost: number
  consumption_by_type: { type: string; qty: number; cost: number }[]
}> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('material_consumption')
    .select('planned_quantity, consumed_quantity, total_cost, consumption_type')
    .eq('org_id', orgId)
    .gte('consumption_date', startDate)
    .lte('consumption_date', endDate)
    .eq('status', 'POSTED')
  
  if (error) throw error
  
  const records = data || []
  let totalPlanned = 0
  let totalConsumed = 0
  let totalCost = 0
  const byType: Record<string, { qty: number; cost: number }> = {}
  
  records.forEach(r => {
    totalPlanned += r.planned_quantity || 0
    totalConsumed += r.consumed_quantity || 0
    totalCost += r.total_cost || 0
    
    const type = r.consumption_type || 'UNKNOWN'
    if (!byType[type]) byType[type] = { qty: 0, cost: 0 }
    byType[type].qty += r.consumed_quantity || 0
    byType[type].cost += r.total_cost || 0
  })
  
  return {
    total_planned_qty: totalPlanned,
    total_consumed_qty: totalConsumed,
    total_variance_qty: totalConsumed - totalPlanned,
    total_cost: totalCost,
    consumption_by_type: Object.entries(byType).map(([type, data]) => ({
      type,
      qty: data.qty,
      cost: data.cost
    }))
  }
}

// =====================================================
// OEE Reports
// =====================================================

/**
 * الحصول على تقرير OEE
 */
export async function getOEEReport(filters?: {
  workCenterId?: string
  fromDate?: string
  toDate?: string
}): Promise<OEEReport[]> {
  const orgId = await getEffectiveTenantId()
  
  let query = supabase
    .from('v_oee_report')
    .select('*')
    .eq('org_id', orgId)
  
  if (filters?.workCenterId) {
    query = query.eq('work_center_id', filters.workCenterId)
  }
  if (filters?.fromDate) {
    query = query.gte('production_date', filters.fromDate)
  }
  if (filters?.toDate) {
    query = query.lte('production_date', filters.toDate)
  }
  
  const { data, error } = await query.order('production_date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على ملخص OEE
 */
export async function getOEESummary(
  startDate: string,
  endDate: string,
  workCenterId?: string
): Promise<OEESummary[]> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .rpc('get_oee_summary', {
      p_org_id: orgId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_work_center_id: workCenterId
    })
  
  if (error) throw error
  return data || []
}

/**
 * حساب متوسط OEE للمنشأة
 */
export async function getOverallOEE(
  startDate: string,
  endDate: string
): Promise<{
  avg_availability: number
  avg_performance: number
  avg_quality: number
  avg_oee: number
  world_class_comparison: {
    availability: boolean
    performance: boolean
    quality: boolean
    oee: boolean
  }
}> {
  const oeeData = await getOEEReport({ fromDate: startDate, toDate: endDate })
  
  if (oeeData.length === 0) {
    return {
      avg_availability: 0,
      avg_performance: 0,
      avg_quality: 0,
      avg_oee: 0,
      world_class_comparison: {
        availability: false,
        performance: false,
        quality: false,
        oee: false
      }
    }
  }
  
  const avgAvailability = oeeData.reduce((sum, r) => sum + (r.availability_pct || 0), 0) / oeeData.length
  const avgPerformance = oeeData.reduce((sum, r) => sum + (r.performance_pct || 0), 0) / oeeData.length
  const avgQuality = oeeData.reduce((sum, r) => sum + (r.quality_pct || 0), 0) / oeeData.length
  const avgOEE = oeeData.reduce((sum, r) => sum + (r.oee_pct || 0), 0) / oeeData.length
  
  // World Class OEE benchmarks
  // Availability >= 90%, Performance >= 95%, Quality >= 99%, OEE >= 85%
  return {
    avg_availability: Math.round(avgAvailability * 100) / 100,
    avg_performance: Math.round(avgPerformance * 100) / 100,
    avg_quality: Math.round(avgQuality * 100) / 100,
    avg_oee: Math.round(avgOEE * 100) / 100,
    world_class_comparison: {
      availability: avgAvailability >= 90,
      performance: avgPerformance >= 95,
      quality: avgQuality >= 99,
      oee: avgOEE >= 85
    }
  }
}

// =====================================================
// Manufacturing Order Integration
// =====================================================

/**
 * تعيين مسار لأمر التصنيع
 */
export async function assignRoutingToMO(
  moId: string,
  routingId: string
): Promise<void> {
  const { error } = await supabase
    .rpc('assign_routing_to_mo', {
      p_mo_id: moId,
      p_routing_id: routingId
    })
  
  if (error) throw error
}

/**
 * إطلاق أمر التصنيع (وإنشاء أوامر العمل)
 */
export async function releaseManufacturingOrder(moId: string): Promise<void> {
  const { error } = await supabase
    .rpc('release_manufacturing_order', {
      p_mo_id: moId
    })
  
  if (error) throw error
}

/**
 * تحديث إعدادات Backflushing لأمر التصنيع
 */
export async function updateBackflushSettings(
  moId: string,
  settings: {
    auto_backflush: boolean
    backflush_timing: 'ON_START' | 'ON_COMPLETION' | 'MANUAL'
  }
): Promise<void> {
  const { error } = await supabase
    .from('manufacturing_orders')
    .update({
      auto_backflush: settings.auto_backflush,
      backflush_timing: settings.backflush_timing,
      updated_at: new Date().toISOString()
    })
    .eq('id', moId)
  
  if (error) throw error
}

// =====================================================
// Dashboard Statistics
// =====================================================

/**
 * الحصول على إحصائيات لوحة التحكم
 */
export async function getDashboardStats(): Promise<{
  today_efficiency: number
  today_oee: number
  today_scrap_rate: number
  week_production: number
  week_variance: number
  active_work_orders: number
}> {
  const orgId = await getEffectiveTenantId()
  const today = new Date().toISOString().split('T')[0]
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 7)
  const weekStartStr = weekStart.toISOString().split('T')[0]
  
  // Today's efficiency
  const { data: todayEfficiency } = await supabase
    .from('v_work_center_efficiency_summary')
    .select('avg_overall_efficiency')
    .eq('org_id', orgId)
    .eq('production_date', today)
  
  const avgTodayEfficiency = todayEfficiency?.length 
    ? todayEfficiency.reduce((sum, r) => sum + (r.avg_overall_efficiency || 0), 0) / todayEfficiency.length
    : 0
  
  // Today's OEE
  const { data: todayOEE } = await supabase
    .from('v_oee_report')
    .select('oee_pct')
    .eq('org_id', orgId)
    .eq('production_date', today)
  
  const avgTodayOEE = todayOEE?.length
    ? todayOEE.reduce((sum, r) => sum + (r.oee_pct || 0), 0) / todayOEE.length
    : 0
  
  // Today's scrap rate
  const { data: todayScrap } = await supabase
    .from('work_orders')
    .select('completed_quantity, scrapped_quantity')
    .eq('org_id', orgId)
    .gte('actual_end_date', today)
    .eq('status', 'COMPLETED')
  
  const totalCompleted = todayScrap?.reduce((sum, r) => sum + (r.completed_quantity || 0), 0) || 0
  const totalScrapped = todayScrap?.reduce((sum, r) => sum + (r.scrapped_quantity || 0), 0) || 0
  const todayScrapRate = totalCompleted + totalScrapped > 0
    ? (totalScrapped / (totalCompleted + totalScrapped)) * 100
    : 0
  
  // Week production
  const { data: weekProduction } = await supabase
    .from('work_orders')
    .select('completed_quantity')
    .eq('org_id', orgId)
    .gte('actual_end_date', weekStartStr)
    .eq('status', 'COMPLETED')
  
  const totalWeekProduction = weekProduction?.reduce((sum, r) => sum + (r.completed_quantity || 0), 0) || 0
  
  // Week variance
  const weekVariances = await getTotalVariances(weekStartStr, today)
  
  // Active work orders
  const { count: activeCount } = await supabase
    .from('work_orders')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('status', ['IN_SETUP', 'IN_PROGRESS'])
  
  return {
    today_efficiency: Math.round(avgTodayEfficiency * 100) / 100,
    today_oee: Math.round(avgTodayOEE * 100) / 100,
    today_scrap_rate: Math.round(todayScrapRate * 100) / 100,
    week_production: totalWeekProduction,
    week_variance: weekVariances.total_variance,
    active_work_orders: activeCount || 0
  }
}

// =====================================================
// Export default service object
// =====================================================

export const efficiencyService = {
  // Labor Efficiency
  getLaborEfficiencyReport,
  getWorkCenterEfficiencySummary,
  getEfficiencySummary,
  
  // Cost Variance
  getCostVarianceReport,
  getTotalVariances,
  
  // Material Consumption
  getMaterialConsumptionReport,
  getTotalMaterialConsumption,
  
  // OEE
  getOEEReport,
  getOEESummary,
  getOverallOEE,
  
  // MO Integration
  assignRoutingToMO,
  releaseManufacturingOrder,
  updateBackflushSettings,
  
  // Dashboard
  getDashboardStats
}

export default efficiencyService

