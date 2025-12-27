/**
 * Capacity Planning Service - خدمة تخطيط الطاقة
 * إدارة الطاقة الإنتاجية وجدولة الإنتاج
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase'

// =====================================================
// Types & Interfaces
// =====================================================

export interface WorkCenterCalendar {
  id: string
  org_id: string
  work_center_id: string
  calendar_date: string
  available_hours: number
  planned_maintenance_hours: number
  shift_count: number
  is_working_day: boolean
  is_holiday: boolean
  holiday_name?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface WorkCenterLoad {
  id: string
  org_id: string
  work_center_id: string
  period_start: string
  period_end: string
  available_capacity_hours: number
  planned_load_hours: number
  actual_load_hours: number
  utilization_pct: number
  efficiency_pct: number
  planned_work_orders: number
  completed_work_orders: number
  status: 'PLANNED' | 'CONFIRMED' | 'ACTUAL'
  calculated_at: string
  created_at: string
  updated_at: string
  // Joined data
  work_center?: {
    id: string
    name: string
    name_ar?: string
  }
}

export interface ProductionSchedule {
  id: string
  org_id: string
  schedule_number: string
  schedule_name?: string
  period_start: string
  period_end: string
  status: 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  total_work_orders: number
  total_planned_hours: number
  approved_by?: string
  approved_at?: string
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  // Joined data
  details?: ScheduleDetail[]
}

export interface ScheduleDetail {
  id: string
  org_id: string
  schedule_id: string
  work_order_id: string
  schedule_sequence: number
  scheduled_start: string
  scheduled_end: string
  priority: number
  schedule_status: 'SCHEDULED' | 'CONFIRMED' | 'STARTED' | 'COMPLETED' | 'DELAYED' | 'CANCELLED'
  delay_reason?: string
  delay_hours?: number
  created_at: string
  updated_at: string
  // Joined data
  work_order?: {
    id: string
    work_order_number: string
    operation_name: string
    planned_quantity: number
  }
}

export interface CapacityCalculation {
  total_available_hours: number
  working_days: number
  avg_daily_hours: number
}

export interface LoadCalculation {
  total_planned_hours: number
  total_work_orders: number
  pending_work_orders: number
  in_progress_work_orders: number
}

export interface BottleneckAnalysis {
  work_center_id: string
  work_center_name: string
  available_hours: number
  planned_hours: number
  utilization_pct: number
  is_bottleneck: boolean
  bottleneck_severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
}

export interface CapacitySummary {
  work_center_id: string
  work_center_name: string
  capacity_hours_per_day: number
  number_of_machines: number
  period_start: string
  period_end: string
  available_capacity_hours: number
  planned_load_hours: number
  actual_load_hours: number
  utilization_pct: number
  planned_work_orders: number
  completed_work_orders: number
  load_status: 'LOW' | 'NORMAL' | 'HIGH' | 'OVERLOADED'
}

// =====================================================
// Work Center Calendar Operations
// =====================================================

/**
 * الحصول على تقويم مركز العمل
 */
export async function getWorkCenterCalendar(
  workCenterId: string,
  startDate: string,
  endDate: string
): Promise<WorkCenterCalendar[]> {
  const { data, error } = await supabase
    .from('work_center_calendars')
    .select('*')
    .eq('work_center_id', workCenterId)
    .gte('calendar_date', startDate)
    .lte('calendar_date', endDate)
    .order('calendar_date', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * تحديث يوم في التقويم
 */
export async function updateCalendarDay(
  workCenterId: string,
  date: string,
  updates: Partial<{
    available_hours: number
    planned_maintenance_hours: number
    shift_count: number
    is_working_day: boolean
    is_holiday: boolean
    holiday_name: string
    notes: string
  }>
): Promise<WorkCenterCalendar> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('work_center_calendars')
    .upsert({
      org_id: orgId,
      work_center_id: workCenterId,
      calendar_date: date,
      ...updates,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'work_center_id,calendar_date'
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * إضافة عطلة
 */
export async function addHoliday(
  workCenterId: string,
  date: string,
  holidayName: string
): Promise<WorkCenterCalendar> {
  return updateCalendarDay(workCenterId, date, {
    is_holiday: true,
    is_working_day: false,
    holiday_name: holidayName,
    available_hours: 0
  })
}

/**
 * إضافة صيانة مخططة
 */
export async function addPlannedMaintenance(
  workCenterId: string,
  date: string,
  maintenanceHours: number,
  notes?: string
): Promise<WorkCenterCalendar> {
  return updateCalendarDay(workCenterId, date, {
    planned_maintenance_hours: maintenanceHours,
    notes
  })
}

// =====================================================
// Capacity Calculations
// =====================================================

/**
 * حساب الطاقة المتاحة لمركز عمل
 */
export async function calculateAvailableCapacity(
  workCenterId: string,
  startDate: string,
  endDate: string
): Promise<CapacityCalculation> {
  const { data, error } = await supabase
    .rpc('calculate_available_capacity', {
      p_work_center_id: workCenterId,
      p_start_date: startDate,
      p_end_date: endDate
    })
  
  if (error) throw error
  return data?.[0] || {
    total_available_hours: 0,
    working_days: 0,
    avg_daily_hours: 0
  }
}

/**
 * حساب الحمل المخطط لمركز عمل
 */
export async function calculatePlannedLoad(
  workCenterId: string,
  startDate: string,
  endDate: string
): Promise<LoadCalculation> {
  const { data, error } = await supabase
    .rpc('calculate_planned_load', {
      p_work_center_id: workCenterId,
      p_start_date: startDate,
      p_end_date: endDate
    })
  
  if (error) throw error
  return data?.[0] || {
    total_planned_hours: 0,
    total_work_orders: 0,
    pending_work_orders: 0,
    in_progress_work_orders: 0
  }
}

/**
 * تحديث حمل مركز العمل
 */
export async function updateWorkCenterLoad(
  workCenterId: string,
  startDate: string,
  endDate: string
): Promise<WorkCenterLoad> {
  const { data, error } = await supabase
    .rpc('update_work_center_load', {
      p_work_center_id: workCenterId,
      p_start_date: startDate,
      p_end_date: endDate
    })
  
  if (error) throw error
  return data
}

/**
 * الحصول على حمل مراكز العمل
 */
export async function getWorkCenterLoads(
  startDate: string,
  endDate: string
): Promise<WorkCenterLoad[]> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('work_center_load')
    .select(`
      *,
      work_center:work_centers(id, name, name_ar)
    `)
    .eq('org_id', orgId)
    .gte('period_start', startDate)
    .lte('period_end', endDate)
    .order('utilization_pct', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * تحديد الاختناقات
 */
export async function identifyBottlenecks(
  startDate: string,
  endDate: string
): Promise<BottleneckAnalysis[]> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .rpc('identify_bottlenecks', {
      p_org_id: orgId,
      p_start_date: startDate,
      p_end_date: endDate
    })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على ملخص الطاقة الإنتاجية
 */
export async function getCapacitySummary(): Promise<CapacitySummary[]> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('v_capacity_summary')
    .select('*')
    .eq('org_id', orgId)
  
  if (error) throw error
  return data || []
}

// =====================================================
// Production Scheduling
// =====================================================

/**
 * الحصول على جداول الإنتاج
 */
export async function getProductionSchedules(filters?: {
  status?: ProductionSchedule['status']
  fromDate?: string
  toDate?: string
}): Promise<ProductionSchedule[]> {
  const orgId = await getEffectiveTenantId()
  
  let query = supabase
    .from('production_schedules')
    .select('*')
    .eq('org_id', orgId)
  
  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  if (filters?.fromDate) {
    query = query.gte('period_start', filters.fromDate)
  }
  if (filters?.toDate) {
    query = query.lte('period_end', filters.toDate)
  }
  
  const { data, error } = await query.order('period_start', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على جدول إنتاج بالمعرف
 */
export async function getProductionScheduleById(id: string): Promise<ProductionSchedule | null> {
  const { data, error } = await supabase
    .from('production_schedules')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  
  // جلب التفاصيل
  if (data) {
    const details = await getScheduleDetails(id)
    data.details = details
  }
  
  return data
}

/**
 * إنشاء جدول إنتاج
 */
export async function createProductionSchedule(scheduleData: {
  schedule_name?: string
  period_start: string
  period_end: string
  notes?: string
}): Promise<ProductionSchedule> {
  const orgId = await getEffectiveTenantId()
  const scheduleNumber = `SCH-${Date.now()}`
  
  const { data, error } = await supabase
    .from('production_schedules')
    .insert({
      org_id: orgId,
      schedule_number: scheduleNumber,
      ...scheduleData,
      status: 'DRAFT',
      total_work_orders: 0,
      total_planned_hours: 0
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * تحديث جدول إنتاج
 */
export async function updateProductionSchedule(
  id: string,
  updates: Partial<{
    schedule_name: string
    period_start: string
    period_end: string
    status: ProductionSchedule['status']
    notes: string
  }>
): Promise<ProductionSchedule> {
  const { data, error } = await supabase
    .from('production_schedules')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * الموافقة على جدول إنتاج
 */
export async function approveProductionSchedule(id: string, userId: string): Promise<ProductionSchedule> {
  const { data, error } = await supabase
    .from('production_schedules')
    .update({
      status: 'CONFIRMED',
      approved_by: userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * حذف جدول إنتاج
 */
export async function deleteProductionSchedule(id: string): Promise<void> {
  const { error } = await supabase
    .from('production_schedules')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

// =====================================================
// Schedule Details
// =====================================================

/**
 * الحصول على تفاصيل الجدول
 */
export async function getScheduleDetails(scheduleId: string): Promise<ScheduleDetail[]> {
  const { data, error } = await supabase
    .from('schedule_details')
    .select(`
      *,
      work_order:work_orders(id, work_order_number, operation_name, planned_quantity)
    `)
    .eq('schedule_id', scheduleId)
    .order('schedule_sequence', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * جدولة أمر عمل
 */
export async function scheduleWorkOrder(
  workOrderId: string,
  scheduledStart: string,
  scheduleId?: string
): Promise<ScheduleDetail | null> {
  const { data, error } = await supabase
    .rpc('schedule_work_order', {
      p_work_order_id: workOrderId,
      p_scheduled_start: scheduledStart,
      p_schedule_id: scheduleId
    })
  
  if (error) throw error
  return data
}

/**
 * جدولة تلقائية لأوامر العمل
 */
export async function autoScheduleWorkOrders(
  workCenterId: string,
  startDate: string,
  scheduleId?: string
): Promise<number> {
  const { data, error } = await supabase
    .rpc('auto_schedule_work_orders', {
      p_work_center_id: workCenterId,
      p_start_date: startDate,
      p_schedule_id: scheduleId
    })
  
  if (error) throw error
  return data || 0
}

/**
 * تحديث حالة عنصر الجدول
 */
export async function updateScheduleDetailStatus(
  detailId: string,
  status: ScheduleDetail['schedule_status'],
  delayReason?: string,
  delayHours?: number
): Promise<ScheduleDetail> {
  const { data, error } = await supabase
    .from('schedule_details')
    .update({
      schedule_status: status,
      delay_reason: delayReason,
      delay_hours: delayHours,
      updated_at: new Date().toISOString()
    })
    .eq('id', detailId)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * إعادة جدولة أمر عمل
 */
export async function rescheduleWorkOrder(
  detailId: string,
  newScheduledStart: string
): Promise<ScheduleDetail> {
  // حساب وقت الانتهاء الجديد بناءً على المدة
  const { data: detail } = await supabase
    .from('schedule_details')
    .select('scheduled_start, scheduled_end')
    .eq('id', detailId)
    .single()
  
  if (!detail) throw new Error('Schedule detail not found')
  
  const duration = new Date(detail.scheduled_end).getTime() - new Date(detail.scheduled_start).getTime()
  const newScheduledEnd = new Date(new Date(newScheduledStart).getTime() + duration).toISOString()
  
  const { data, error } = await supabase
    .from('schedule_details')
    .update({
      scheduled_start: newScheduledStart,
      scheduled_end: newScheduledEnd,
      updated_at: new Date().toISOString()
    })
    .eq('id', detailId)
    .select()
    .single()
  
  if (error) throw error
  return data
}

// =====================================================
// Dashboard & Analytics
// =====================================================

/**
 * الحصول على ملخص الجدولة الأسبوعية
 */
export async function getWeeklyScheduleSummary(): Promise<{
  week_start: string
  week_end: string
  total_scheduled: number
  completed: number
  in_progress: number
  delayed: number
  utilization_avg: number
}> {
  const today = new Date()
  const weekStart = new Date(today.setDate(today.getDate() - today.getDay())).toISOString().split('T')[0]
  const weekEnd = new Date(today.setDate(today.getDate() + 6)).toISOString().split('T')[0]
  
  const orgId = await getEffectiveTenantId()
  
  // الحصول على إحصائيات الأسبوع
  const { data: scheduleDetails } = await supabase
    .from('schedule_details')
    .select('schedule_status')
    .eq('org_id', orgId)
    .gte('scheduled_start', weekStart)
    .lte('scheduled_end', weekEnd)
  
  const { data: loads } = await supabase
    .from('work_center_load')
    .select('utilization_pct')
    .eq('org_id', orgId)
    .gte('period_start', weekStart)
    .lte('period_end', weekEnd)
  
  const details = scheduleDetails || []
  const avgUtilization = loads?.length 
    ? loads.reduce((sum, l) => sum + (l.utilization_pct || 0), 0) / loads.length 
    : 0
  
  return {
    week_start: weekStart,
    week_end: weekEnd,
    total_scheduled: details.length,
    completed: details.filter(d => d.schedule_status === 'COMPLETED').length,
    in_progress: details.filter(d => d.schedule_status === 'STARTED').length,
    delayed: details.filter(d => d.schedule_status === 'DELAYED').length,
    utilization_avg: Math.round(avgUtilization)
  }
}

/**
 * التنبؤ بالتأخيرات المحتملة
 */
export async function predictDelays(daysAhead: number = 7): Promise<{
  work_order_id: string
  work_order_number: string
  scheduled_end: string
  predicted_delay_hours: number
  reason: string
}[]> {
  const orgId = await getEffectiveTenantId()
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + daysAhead)
  
  // الحصول على أوامر العمل المجدولة
  const { data } = await supabase
    .from('schedule_details')
    .select(`
      *,
      work_order:work_orders(
        id,
        work_order_number,
        status,
        planned_run_time,
        actual_run_time,
        work_center_id
      )
    `)
    .eq('org_id', orgId)
    .gte('scheduled_end', new Date().toISOString())
    .lte('scheduled_end', futureDate.toISOString())
    .in('schedule_status', ['SCHEDULED', 'CONFIRMED', 'STARTED'])
  
  const predictions: {
    work_order_id: string
    work_order_number: string
    scheduled_end: string
    predicted_delay_hours: number
    reason: string
  }[] = []
  
  for (const detail of data || []) {
    const wo = detail.work_order
    if (!wo) continue
    
    // التحقق من التأخير المحتمل بناءً على الأداء السابق
    if (wo.actual_run_time && wo.planned_run_time) {
      const efficiency = wo.planned_run_time / wo.actual_run_time
      if (efficiency < 0.9) {
        const predictedDelay = (wo.planned_run_time / efficiency - wo.planned_run_time) / 60
        predictions.push({
          work_order_id: wo.id,
          work_order_number: wo.work_order_number,
          scheduled_end: detail.scheduled_end,
          predicted_delay_hours: Math.round(predictedDelay * 10) / 10,
          reason: 'كفاءة أقل من المتوقع'
        })
      }
    }
  }
  
  return predictions
}

// =====================================================
// Export default service object
// =====================================================

export const capacityService = {
  // Calendar
  getWorkCenterCalendar,
  updateCalendarDay,
  addHoliday,
  addPlannedMaintenance,
  
  // Capacity Calculations
  calculateAvailableCapacity,
  calculatePlannedLoad,
  updateWorkCenterLoad,
  getWorkCenterLoads,
  identifyBottlenecks,
  getCapacitySummary,
  
  // Scheduling
  getProductionSchedules,
  getProductionScheduleById,
  createProductionSchedule,
  updateProductionSchedule,
  approveProductionSchedule,
  deleteProductionSchedule,
  
  // Schedule Details
  getScheduleDetails,
  scheduleWorkOrder,
  autoScheduleWorkOrders,
  updateScheduleDetailStatus,
  rescheduleWorkOrder,
  
  // Analytics
  getWeeklyScheduleSummary,
  predictDelays
}

export default capacityService

