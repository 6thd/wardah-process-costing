/**
 * MES Service - خدمة نظام تنفيذ التصنيع
 * Manufacturing Execution System
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase'

// =====================================================
// Types & Interfaces
// =====================================================

export interface WorkOrder {
  id: string
  org_id: string
  mo_id: string
  operation_id?: string
  work_center_id: string
  work_order_number: string
  operation_sequence: number
  operation_name: string
  operation_name_ar?: string
  planned_quantity: number
  completed_quantity: number
  scrapped_quantity: number
  planned_setup_time: number
  planned_run_time: number
  actual_setup_time: number
  actual_run_time: number
  actual_wait_time: number
  planned_start_date?: string
  planned_end_date?: string
  actual_start_date?: string
  actual_end_date?: string
  status: WorkOrderStatus
  priority: number
  current_operator_id?: string
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  // Joined data
  manufacturing_order?: {
    id: string
    order_number: string
    item_id: string
    quantity: number
  }
  work_center?: {
    id: string
    name: string
    name_ar?: string
  }
  current_operator?: {
    id: string
    email: string
  }
}

export type WorkOrderStatus = 
  | 'PENDING' 
  | 'READY' 
  | 'IN_SETUP' 
  | 'IN_PROGRESS' 
  | 'ON_HOLD' 
  | 'COMPLETED' 
  | 'CANCELLED'

export interface OperationExecutionLog {
  id: string
  org_id: string
  work_order_id: string
  event_type: OperationEventType
  operator_id?: string
  quantity_produced?: number
  quantity_scrapped?: number
  reason_code?: string
  reason_description?: string
  event_timestamp: string
  duration_minutes?: number
  notes?: string
  created_at: string
}

export type OperationEventType = 
  | 'SETUP_START' 
  | 'SETUP_END' 
  | 'PRODUCTION_START' 
  | 'PRODUCTION_PAUSE'
  | 'PRODUCTION_RESUME' 
  | 'PRODUCTION_END' 
  | 'QUANTITY_REPORT' 
  | 'SCRAP_REPORT'
  | 'QUALITY_CHECK' 
  | 'MACHINE_DOWN' 
  | 'MACHINE_UP' 
  | 'SHIFT_CHANGE' 
  | 'NOTE_ADDED'

export interface LaborTimeTracking {
  id: string
  org_id: string
  work_order_id: string
  employee_id?: string
  employee_name?: string
  labor_type: 'DIRECT' | 'INDIRECT' | 'SETUP' | 'REWORK' | 'MAINTENANCE'
  clock_in: string
  clock_out?: string
  break_minutes: number
  total_minutes?: number
  billable_minutes?: number
  hourly_rate?: number
  total_cost?: number
  status: 'ACTIVE' | 'COMPLETED' | 'VOIDED'
  notes?: string
  created_at: string
  updated_at: string
}

export interface QualityInspection {
  id: string
  org_id: string
  work_order_id: string
  inspection_number: string
  inspection_type: 'INCOMING' | 'IN_PROCESS' | 'FINAL' | 'RANDOM'
  inspector_id?: string
  sample_size?: number
  passed_quantity?: number
  failed_quantity?: number
  result?: 'PASS' | 'FAIL' | 'CONDITIONAL'
  inspection_date: string
  specifications?: string
  findings?: string
  corrective_action?: string
  attachments?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MaterialConsumption {
  id: string
  org_id: string
  work_order_id: string
  mo_id: string
  item_id: string
  planned_quantity?: number
  consumed_quantity: number
  consumption_type: 'BACKFLUSH' | 'MANUAL' | 'NEGATIVE'
  warehouse_id?: string
  location_id?: string
  lot_number?: string
  unit_cost?: number
  total_cost?: number
  status: 'PENDING' | 'POSTED' | 'REVERSED'
  consumption_date: string
  notes?: string
  created_by?: string
  created_at: string
  // Joined data
  item?: {
    id: string
    name: string
    code: string
  }
}

export interface MachineDowntime {
  id: string
  org_id: string
  work_center_id: string
  work_order_id?: string
  downtime_reason: string
  downtime_category: 'BREAKDOWN' | 'PLANNED' | 'CHANGEOVER' | 'NO_MATERIAL' | 'NO_OPERATOR' | 'QUALITY_ISSUE' | 'OTHER'
  start_time: string
  end_time?: string
  duration_minutes?: number
  units_lost?: number
  cost_impact?: number
  action_taken?: string
  resolved_by?: string
  notes?: string
  reported_by?: string
  created_at: string
}

export interface OperatorSession {
  id: string
  org_id: string
  operator_id: string
  work_center_id: string
  current_work_order_id?: string
  session_start: string
  session_end?: string
  status: 'ACTIVE' | 'ON_BREAK' | 'ENDED'
  device_info?: Record<string, unknown>
  created_at: string
}

// =====================================================
// Work Order Operations
// =====================================================

/**
 * الحصول على أوامر العمل
 */
export async function getWorkOrders(filters?: {
  moId?: string
  workCenterId?: string
  status?: WorkOrderStatus | WorkOrderStatus[]
  fromDate?: string
  toDate?: string
}): Promise<WorkOrder[]> {
  const orgId = await getEffectiveTenantId()
  
  let query = supabase
    .from('work_orders')
    .select(`
      *,
      manufacturing_order:manufacturing_orders(id, order_number, item_id, quantity),
      work_center:work_centers(id, name, name_ar)
    `)
    .eq('org_id', orgId)
  
  if (filters?.moId) {
    query = query.eq('mo_id', filters.moId)
  }
  if (filters?.workCenterId) {
    query = query.eq('work_center_id', filters.workCenterId)
  }
  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status)
    } else {
      query = query.eq('status', filters.status)
    }
  }
  if (filters?.fromDate) {
    query = query.gte('planned_start_date', filters.fromDate)
  }
  if (filters?.toDate) {
    query = query.lte('planned_end_date', filters.toDate)
  }
  
  const { data, error } = await query.order('operation_sequence', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على أمر عمل بالمعرف
 */
export async function getWorkOrderById(id: string): Promise<WorkOrder | null> {
  const { data, error } = await supabase
    .from('work_orders')
    .select(`
      *,
      manufacturing_order:manufacturing_orders(id, order_number, item_id, quantity),
      work_center:work_centers(id, name, name_ar)
    `)
    .eq('id', id)
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

/**
 * إنشاء أوامر عمل من أمر تصنيع
 */
export async function generateWorkOrdersFromMO(moId: string): Promise<WorkOrder[]> {
  const { data, error } = await supabase
    .rpc('generate_work_orders_from_mo', { p_mo_id: moId })
  
  if (error) throw error
  return data || []
}

/**
 * بدء عملية
 */
export async function startOperation(
  workOrderId: string,
  operatorId?: string,
  isSetup: boolean = true
): Promise<WorkOrder> {
  const { data, error } = await supabase
    .rpc('start_operation', {
      p_work_order_id: workOrderId,
      p_operator_id: operatorId,
      p_is_setup: isSetup
    })
  
  if (error) throw error
  return data
}

/**
 * إنهاء عملية
 */
export async function completeOperation(
  workOrderId: string,
  quantityProduced: number,
  quantityScrapped: number = 0,
  notes?: string
): Promise<WorkOrder> {
  const { data, error } = await supabase
    .rpc('complete_operation', {
      p_work_order_id: workOrderId,
      p_quantity_produced: quantityProduced,
      p_quantity_scrapped: quantityScrapped,
      p_notes: notes
    })
  
  if (error) throw error
  return data
}

/**
 * تحديث حالة أمر العمل
 */
export async function updateWorkOrderStatus(
  workOrderId: string,
  status: WorkOrderStatus,
  notes?: string
): Promise<WorkOrder> {
  const { data, error } = await supabase
    .from('work_orders')
    .update({
      status,
      notes: notes || undefined,
      updated_at: new Date().toISOString()
    })
    .eq('id', workOrderId)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * إيقاف مؤقت لأمر العمل
 */
export async function pauseWorkOrder(workOrderId: string, reason?: string): Promise<WorkOrder> {
  const orgId = await getEffectiveTenantId()
  
  // تسجيل حدث الإيقاف
  await supabase
    .from('operation_execution_logs')
    .insert({
      org_id: orgId,
      work_order_id: workOrderId,
      event_type: 'PRODUCTION_PAUSE',
      reason_description: reason,
      event_timestamp: new Date().toISOString()
    })
  
  // تحديث تسجيل الوقت
  await supabase
    .from('labor_time_tracking')
    .update({
      clock_out: new Date().toISOString(),
      status: 'COMPLETED',
      updated_at: new Date().toISOString()
    })
    .eq('work_order_id', workOrderId)
    .eq('status', 'ACTIVE')
  
  return updateWorkOrderStatus(workOrderId, 'ON_HOLD', reason)
}

/**
 * استئناف أمر العمل
 */
export async function resumeWorkOrder(workOrderId: string, operatorId?: string): Promise<WorkOrder> {
  return startOperation(workOrderId, operatorId, false)
}

// =====================================================
// Operation Execution Logs
// =====================================================

/**
 * الحصول على سجلات التنفيذ لأمر عمل
 */
export async function getOperationLogs(workOrderId: string): Promise<OperationExecutionLog[]> {
  const { data, error } = await supabase
    .from('operation_execution_logs')
    .select('*')
    .eq('work_order_id', workOrderId)
    .order('event_timestamp', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * إضافة سجل تنفيذ
 */
export async function addOperationLog(
  workOrderId: string,
  eventType: OperationEventType,
  data: {
    quantityProduced?: number
    quantityScrapped?: number
    reasonCode?: string
    reasonDescription?: string
    notes?: string
  } = {}
): Promise<OperationExecutionLog> {
  const orgId = await getEffectiveTenantId()
  
  const { data: result, error } = await supabase
    .from('operation_execution_logs')
    .insert({
      org_id: orgId,
      work_order_id: workOrderId,
      event_type: eventType,
      quantity_produced: data.quantityProduced,
      quantity_scrapped: data.quantityScrapped,
      reason_code: data.reasonCode,
      reason_description: data.reasonDescription,
      notes: data.notes,
      event_timestamp: new Date().toISOString()
    })
    .select()
    .single()
  
  if (error) throw error
  return result
}

// =====================================================
// Labor Time Tracking
// =====================================================

/**
 * الحصول على سجلات الوقت لأمر عمل
 */
export async function getLaborTimeRecords(workOrderId: string): Promise<LaborTimeTracking[]> {
  const { data, error } = await supabase
    .from('labor_time_tracking')
    .select('*')
    .eq('work_order_id', workOrderId)
    .order('clock_in', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * تسجيل دخول عامل
 */
export async function clockIn(
  workOrderId: string,
  employeeId: string,
  laborType: LaborTimeTracking['labor_type'] = 'DIRECT',
  hourlyRate?: number
): Promise<LaborTimeTracking> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('labor_time_tracking')
    .insert({
      org_id: orgId,
      work_order_id: workOrderId,
      employee_id: employeeId,
      labor_type: laborType,
      clock_in: new Date().toISOString(),
      hourly_rate: hourlyRate,
      status: 'ACTIVE'
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * تسجيل خروج عامل
 */
export async function clockOut(
  laborTrackingId: string,
  breakMinutes: number = 0
): Promise<LaborTimeTracking> {
  const clockOut = new Date().toISOString()
  
  // الحصول على السجل الحالي
  const { data: current } = await supabase
    .from('labor_time_tracking')
    .select('clock_in, hourly_rate')
    .eq('id', laborTrackingId)
    .single()
  
  if (!current) throw new Error('Labor tracking record not found')
  
  const clockInTime = new Date(current.clock_in)
  const clockOutTime = new Date(clockOut)
  const totalMinutes = (clockOutTime.getTime() - clockInTime.getTime()) / 60000
  const billableMinutes = totalMinutes - breakMinutes
  const totalCost = (billableMinutes / 60) * (current.hourly_rate || 0)
  
  const { data, error } = await supabase
    .from('labor_time_tracking')
    .update({
      clock_out: clockOut,
      break_minutes: breakMinutes,
      total_minutes: totalMinutes,
      billable_minutes: billableMinutes,
      total_cost: totalCost,
      status: 'COMPLETED',
      updated_at: new Date().toISOString()
    })
    .eq('id', laborTrackingId)
    .select()
    .single()
  
  if (error) throw error
  return data
}

// =====================================================
// Quality Inspections
// =====================================================

/**
 * الحصول على فحوصات الجودة لأمر عمل
 */
export async function getQualityInspections(workOrderId: string): Promise<QualityInspection[]> {
  const { data, error } = await supabase
    .from('quality_inspections')
    .select('*')
    .eq('work_order_id', workOrderId)
    .order('inspection_date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * إنشاء فحص جودة
 */
export async function createQualityInspection(
  workOrderId: string,
  inspectionData: {
    inspection_type: QualityInspection['inspection_type']
    sample_size: number
    passed_quantity: number
    failed_quantity: number
    result: QualityInspection['result']
    specifications?: string
    findings?: string
    corrective_action?: string
  }
): Promise<QualityInspection> {
  const orgId = await getEffectiveTenantId()
  const inspectionNumber = `QI-${Date.now()}`
  
  const { data, error } = await supabase
    .from('quality_inspections')
    .insert({
      org_id: orgId,
      work_order_id: workOrderId,
      inspection_number: inspectionNumber,
      ...inspectionData,
      inspection_date: new Date().toISOString()
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

// =====================================================
// Material Consumption / Backflushing
// =====================================================

/**
 * الحصول على استهلاك المواد لأمر عمل
 */
export async function getMaterialConsumption(workOrderId: string): Promise<MaterialConsumption[]> {
  const { data, error } = await supabase
    .from('material_consumption')
    .select(`
      *,
      item:items(id, name, code)
    `)
    .eq('work_order_id', workOrderId)
    .order('consumption_date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * تنفيذ Backflushing للمواد
 */
export async function backflushMaterials(
  workOrderId: string,
  quantityProduced: number
): Promise<MaterialConsumption[]> {
  const { data, error } = await supabase
    .rpc('backflush_materials', {
      p_work_order_id: workOrderId,
      p_quantity_produced: quantityProduced
    })
  
  if (error) throw error
  return data || []
}

/**
 * استهلاك مواد يدوي
 */
export async function consumeMaterial(
  workOrderId: string,
  itemId: string,
  quantity: number,
  unitCost?: number,
  notes?: string
): Promise<MaterialConsumption> {
  const orgId = await getEffectiveTenantId()
  
  // الحصول على mo_id من أمر العمل
  const { data: workOrder } = await supabase
    .from('work_orders')
    .select('mo_id')
    .eq('id', workOrderId)
    .single()
  
  if (!workOrder) throw new Error('Work order not found')
  
  const { data, error } = await supabase
    .from('material_consumption')
    .insert({
      org_id: orgId,
      work_order_id: workOrderId,
      mo_id: workOrder.mo_id,
      item_id: itemId,
      consumed_quantity: quantity,
      consumption_type: 'MANUAL',
      unit_cost: unitCost,
      total_cost: unitCost ? unitCost * quantity : undefined,
      status: 'PENDING',
      consumption_date: new Date().toISOString(),
      notes
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

// =====================================================
// Machine Downtime
// =====================================================

/**
 * الحصول على سجلات التوقف لمركز عمل
 */
export async function getMachineDowntime(workCenterId: string, fromDate?: string, toDate?: string): Promise<MachineDowntime[]> {
  let query = supabase
    .from('machine_downtime')
    .select('*')
    .eq('work_center_id', workCenterId)
  
  if (fromDate) {
    query = query.gte('start_time', fromDate)
  }
  if (toDate) {
    query = query.lte('start_time', toDate)
  }
  
  const { data, error } = await query.order('start_time', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * تسجيل توقف آلة
 */
export async function reportMachineDown(
  workCenterId: string,
  reason: string,
  category: MachineDowntime['downtime_category'],
  workOrderId?: string,
  notes?: string
): Promise<MachineDowntime> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('machine_downtime')
    .insert({
      org_id: orgId,
      work_center_id: workCenterId,
      work_order_id: workOrderId,
      downtime_reason: reason,
      downtime_category: category,
      start_time: new Date().toISOString(),
      notes
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * إنهاء توقف آلة
 */
export async function resolveMachineDown(
  downtimeId: string,
  actionTaken?: string
): Promise<MachineDowntime> {
  const endTime = new Date().toISOString()
  
  // الحصول على السجل الحالي
  const { data: current } = await supabase
    .from('machine_downtime')
    .select('start_time')
    .eq('id', downtimeId)
    .single()
  
  if (!current) throw new Error('Downtime record not found')
  
  const startTime = new Date(current.start_time)
  const durationMinutes = (new Date(endTime).getTime() - startTime.getTime()) / 60000
  
  const { data, error } = await supabase
    .from('machine_downtime')
    .update({
      end_time: endTime,
      duration_minutes: durationMinutes,
      action_taken: actionTaken
    })
    .eq('id', downtimeId)
    .select()
    .single()
  
  if (error) throw error
  return data
}

// =====================================================
// Operator Sessions
// =====================================================

/**
 * بدء جلسة مشغل
 */
export async function startOperatorSession(
  operatorId: string,
  workCenterId: string,
  deviceInfo?: Record<string, unknown>
): Promise<OperatorSession> {
  const orgId = await getEffectiveTenantId()
  
  // إنهاء أي جلسة نشطة سابقة
  await supabase
    .from('operator_sessions')
    .update({
      session_end: new Date().toISOString(),
      status: 'ENDED'
    })
    .eq('operator_id', operatorId)
    .eq('status', 'ACTIVE')
  
  const { data, error } = await supabase
    .from('operator_sessions')
    .insert({
      org_id: orgId,
      operator_id: operatorId,
      work_center_id: workCenterId,
      session_start: new Date().toISOString(),
      status: 'ACTIVE',
      device_info: deviceInfo
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * إنهاء جلسة مشغل
 */
export async function endOperatorSession(sessionId: string): Promise<OperatorSession> {
  const { data, error } = await supabase
    .from('operator_sessions')
    .update({
      session_end: new Date().toISOString(),
      status: 'ENDED'
    })
    .eq('id', sessionId)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * الحصول على الجلسة النشطة للمشغل
 */
export async function getActiveOperatorSession(operatorId: string): Promise<OperatorSession | null> {
  const { data, error } = await supabase
    .from('operator_sessions')
    .select('*')
    .eq('operator_id', operatorId)
    .eq('status', 'ACTIVE')
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

// =====================================================
// Dashboard & Analytics
// =====================================================

/**
 * الحصول على ملخص أوامر العمل لمركز عمل
 */
export async function getWorkCenterSummary(workCenterId: string): Promise<{
  pending: number
  in_progress: number
  completed_today: number
  total_produced_today: number
  efficiency: number
}> {
  const today = new Date().toISOString().split('T')[0]
  
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select('status, completed_quantity, planned_run_time, actual_run_time')
    .eq('work_center_id', workCenterId)
  
  if (!workOrders) {
    return {
      pending: 0,
      in_progress: 0,
      completed_today: 0,
      total_produced_today: 0,
      efficiency: 100
    }
  }
  
  const pending = workOrders.filter(wo => wo.status === 'PENDING' || wo.status === 'READY').length
  const inProgress = workOrders.filter(wo => wo.status === 'IN_PROGRESS' || wo.status === 'IN_SETUP').length
  
  const { data: completedToday } = await supabase
    .from('work_orders')
    .select('completed_quantity')
    .eq('work_center_id', workCenterId)
    .eq('status', 'COMPLETED')
    .gte('actual_end_date', today)
  
  const totalProducedToday = completedToday?.reduce((sum, wo) => sum + (wo.completed_quantity || 0), 0) || 0
  
  // حساب الكفاءة
  const totalPlanned = workOrders.reduce((sum, wo) => sum + (wo.planned_run_time || 0), 0)
  const totalActual = workOrders.reduce((sum, wo) => sum + (wo.actual_run_time || 0), 0)
  const efficiency = totalActual > 0 ? Math.round((totalPlanned / totalActual) * 100) : 100
  
  return {
    pending,
    in_progress: inProgress,
    completed_today: completedToday?.length || 0,
    total_produced_today: totalProducedToday,
    efficiency
  }
}

// =====================================================
// Work Centers
// =====================================================

/**
 * الحصول على مراكز العمل
 */
export async function getWorkCenters() {
  const orgId = await getEffectiveTenantId()
  
  return supabase
    .from('work_centers')
    .select('*')
    .eq('org_id', orgId)
    .order('name')
}

// =====================================================
// Export default service object
// =====================================================

export const mesService = {
  // Work Orders
  getWorkOrders,
  getWorkOrderById,
  generateWorkOrdersFromMO,
  startOperation,
  completeOperation,
  updateWorkOrderStatus,
  pauseWorkOrder,
  resumeWorkOrder,
  
  // Operation Logs
  getOperationLogs,
  addOperationLog,
  
  // Labor Time
  getLaborTimeRecords,
  clockIn,
  clockOut,
  
  // Quality
  getQualityInspections,
  createQualityInspection,
  
  // Materials
  getMaterialConsumption,
  backflushMaterials,
  consumeMaterial,
  
  // Downtime
  getMachineDowntime,
  reportMachineDown,
  resolveMachineDown,
  
  // Operator Sessions
  startOperatorSession,
  endOperatorSession,
  getActiveOperatorSession,
  
  // Analytics
  getWorkCenterSummary,
  
  // Work Centers
  getWorkCenters
}

export default mesService

