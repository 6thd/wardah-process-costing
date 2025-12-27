/**
 * Routing Service - خدمة مسارات التصنيع
 * إدارة مسارات التصنيع والعمليات
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase'

// =====================================================
// Types & Interfaces
// =====================================================

export interface Routing {
  id: string
  org_id: string
  routing_code: string
  routing_name: string
  routing_name_ar?: string
  description?: string
  description_ar?: string
  version: number
  status: 'DRAFT' | 'APPROVED' | 'OBSOLETE'
  is_active: boolean
  item_id?: string
  effective_date: string
  expiry_date?: string
  approved_by?: string
  approved_at?: string
  created_by?: string
  created_at: string
  updated_at: string
  // Joined data
  item?: {
    id: string
    name: string
    code: string
  }
  operations?: RoutingOperation[]
}

export interface RoutingOperation {
  id: string
  org_id: string
  routing_id: string
  operation_sequence: number
  operation_code: string
  operation_name: string
  operation_name_ar?: string
  description?: string
  work_center_id?: string
  standard_setup_time: number
  standard_run_time_per_unit: number
  standard_queue_time: number
  standard_move_time: number
  time_unit: 'MINUTES' | 'HOURS' | 'DAYS'
  labor_rate_per_hour: number
  overhead_rate_per_hour: number
  operation_type: 'PRODUCTION' | 'INSPECTION' | 'SETUP' | 'PACKAGING' | 'TRANSFER' | 'SUBCONTRACT'
  is_outsourced: boolean
  outsource_vendor_id?: string
  outsource_cost?: number
  requires_inspection: boolean
  inspection_instructions?: string
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined data
  work_center?: {
    id: string
    name: string
    name_ar?: string
  }
  resources?: OperationResource[]
}

export interface OperationResource {
  id: string
  org_id: string
  operation_id: string
  resource_type: 'LABOR' | 'MACHINE' | 'TOOL' | 'SKILL'
  resource_code?: string
  resource_name?: string
  quantity_required: number
  unit_of_measure?: string
  cost_rate: number
  notes?: string
  created_at: string
  updated_at: string
}

export interface RoutingFormData {
  routing_code: string
  routing_name: string
  routing_name_ar?: string
  description?: string
  description_ar?: string
  version?: number
  status?: 'DRAFT' | 'APPROVED' | 'OBSOLETE'
  is_active?: boolean
  item_id?: string
  effective_date?: string
  expiry_date?: string
}

export interface OperationFormData {
  routing_id: string
  operation_sequence: number
  operation_code: string
  operation_name: string
  operation_name_ar?: string
  description?: string
  work_center_id?: string
  standard_setup_time?: number
  standard_run_time_per_unit?: number
  standard_queue_time?: number
  standard_move_time?: number
  time_unit?: 'MINUTES' | 'HOURS' | 'DAYS'
  labor_rate_per_hour?: number
  overhead_rate_per_hour?: number
  operation_type?: string
  is_outsourced?: boolean
  requires_inspection?: boolean
  inspection_instructions?: string
}

export interface RoutingTimeCalculation {
  total_setup_time: number
  total_run_time: number
  total_queue_time: number
  total_move_time: number
  total_lead_time: number
}

export interface RoutingCostCalculation {
  total_labor_cost: number
  total_overhead_cost: number
  total_routing_cost: number
}

// =====================================================
// Routing CRUD Operations
// =====================================================

/**
 * الحصول على جميع مسارات التصنيع
 */
export async function getRoutings(orgId?: string): Promise<Routing[]> {
  const effectiveOrgId = orgId || await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('routings')
    .select(`
      *,
      item:items(id, name, code)
    `)
    .eq('org_id', effectiveOrgId)
    .order('routing_code', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على مسار تصنيع بالمعرف
 */
export async function getRoutingById(id: string): Promise<Routing | null> {
  const { data, error } = await supabase
    .from('routings')
    .select(`
      *,
      item:items(id, name, code)
    `)
    .eq('id', id)
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  
  // جلب العمليات
  if (data) {
    const operations = await getRoutingOperations(id)
    data.operations = operations
  }
  
  return data
}

/**
 * الحصول على مسارات التصنيع لمنتج معين
 */
export async function getRoutingsByItem(itemId: string): Promise<Routing[]> {
  const { data, error } = await supabase
    .from('routings')
    .select('*')
    .eq('item_id', itemId)
    .eq('is_active', true)
    .order('version', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * إنشاء مسار تصنيع جديد
 */
export async function createRouting(formData: RoutingFormData): Promise<Routing> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('routings')
    .insert({
      ...formData,
      org_id: orgId,
      version: formData.version || 1,
      status: formData.status || 'DRAFT',
      is_active: formData.is_active ?? true,
      effective_date: formData.effective_date || new Date().toISOString().split('T')[0]
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * تحديث مسار تصنيع
 */
export async function updateRouting(id: string, formData: Partial<RoutingFormData>): Promise<Routing> {
  const { data, error } = await supabase
    .from('routings')
    .update({
      ...formData,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * حذف مسار تصنيع
 */
export async function deleteRouting(id: string): Promise<void> {
  const { error } = await supabase
    .from('routings')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

/**
 * الموافقة على مسار تصنيع
 */
export async function approveRouting(id: string, userId: string): Promise<Routing> {
  const { data, error } = await supabase
    .from('routings')
    .update({
      status: 'APPROVED',
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
 * نسخ مسار تصنيع
 */
export async function copyRouting(id: string, newCode: string, newVersion?: number): Promise<string> {
  const { data, error } = await supabase
    .rpc('copy_routing', {
      p_routing_id: id,
      p_new_code: newCode,
      p_new_version: newVersion || 1
    })
  
  if (error) throw error
  return data
}

// =====================================================
// Operation CRUD Operations
// =====================================================

/**
 * الحصول على عمليات مسار التصنيع
 */
export async function getRoutingOperations(routingId: string): Promise<RoutingOperation[]> {
  const { data, error } = await supabase
    .from('routing_operations')
    .select(`
      *,
      work_center:work_centers(id, name, name_ar)
    `)
    .eq('routing_id', routingId)
    .order('operation_sequence', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * الحصول على عملية بالمعرف
 */
export async function getOperationById(id: string): Promise<RoutingOperation | null> {
  const { data, error } = await supabase
    .from('routing_operations')
    .select(`
      *,
      work_center:work_centers(id, name, name_ar)
    `)
    .eq('id', id)
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  
  // جلب الموارد
  if (data) {
    const resources = await getOperationResources(id)
    data.resources = resources
  }
  
  return data
}

/**
 * إنشاء عملية جديدة
 */
export async function createOperation(formData: OperationFormData): Promise<RoutingOperation> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('routing_operations')
    .insert({
      ...formData,
      org_id: orgId,
      standard_setup_time: formData.standard_setup_time || 0,
      standard_run_time_per_unit: formData.standard_run_time_per_unit || 0,
      standard_queue_time: formData.standard_queue_time || 0,
      standard_move_time: formData.standard_move_time || 0,
      time_unit: formData.time_unit || 'MINUTES',
      labor_rate_per_hour: formData.labor_rate_per_hour || 0,
      overhead_rate_per_hour: formData.overhead_rate_per_hour || 0,
      operation_type: formData.operation_type || 'PRODUCTION',
      is_outsourced: formData.is_outsourced || false,
      requires_inspection: formData.requires_inspection || false,
      is_active: true
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * تحديث عملية
 */
export async function updateOperation(id: string, formData: Partial<OperationFormData>): Promise<RoutingOperation> {
  const { data, error } = await supabase
    .from('routing_operations')
    .update({
      ...formData,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * حذف عملية
 */
export async function deleteOperation(id: string): Promise<void> {
  const { error } = await supabase
    .from('routing_operations')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

/**
 * إعادة ترتيب العمليات
 */
export async function reorderOperations(routingId: string, operationIds: string[]): Promise<void> {
  const updates = operationIds.map((id, index) => ({
    id,
    operation_sequence: index + 1
  }))
  
  for (const update of updates) {
    const { error } = await supabase
      .from('routing_operations')
      .update({ operation_sequence: update.operation_sequence })
      .eq('id', update.id)
    
    if (error) throw error
  }
}

// =====================================================
// Resource CRUD Operations
// =====================================================

/**
 * الحصول على موارد العملية
 */
export async function getOperationResources(operationId: string): Promise<OperationResource[]> {
  const { data, error } = await supabase
    .from('operation_resources')
    .select('*')
    .eq('operation_id', operationId)
    .order('created_at', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * إضافة مورد للعملية
 */
export async function addOperationResource(
  operationId: string,
  resourceData: Omit<OperationResource, 'id' | 'org_id' | 'operation_id' | 'created_at' | 'updated_at'>
): Promise<OperationResource> {
  const orgId = await getEffectiveTenantId()
  
  const { data, error } = await supabase
    .from('operation_resources')
    .insert({
      ...resourceData,
      org_id: orgId,
      operation_id: operationId
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * حذف مورد
 */
export async function deleteOperationResource(id: string): Promise<void> {
  const { error } = await supabase
    .from('operation_resources')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

// =====================================================
// Calculations
// =====================================================

/**
 * حساب إجمالي وقت المسار
 */
export async function calculateRoutingTime(
  routingId: string,
  quantity: number = 1
): Promise<RoutingTimeCalculation> {
  const { data, error } = await supabase
    .rpc('calculate_routing_total_time', {
      p_routing_id: routingId,
      p_quantity: quantity
    })
  
  if (error) throw error
  return data?.[0] || {
    total_setup_time: 0,
    total_run_time: 0,
    total_queue_time: 0,
    total_move_time: 0,
    total_lead_time: 0
  }
}

/**
 * حساب تكلفة المسار القياسية
 */
export async function calculateRoutingCost(
  routingId: string,
  quantity: number = 1
): Promise<RoutingCostCalculation> {
  const { data, error } = await supabase
    .rpc('calculate_routing_standard_cost', {
      p_routing_id: routingId,
      p_quantity: quantity
    })
  
  if (error) throw error
  return data?.[0] || {
    total_labor_cost: 0,
    total_overhead_cost: 0,
    total_routing_cost: 0
  }
}

/**
 * حساب إجمالي وقت وتكلفة المسار (محلياً بدون RPC)
 */
export async function calculateRoutingTotals(routingId: string, quantity: number = 1): Promise<{
  time: RoutingTimeCalculation
  cost: RoutingCostCalculation
}> {
  const operations = await getRoutingOperations(routingId)
  
  let totalSetupTime = 0
  let totalRunTime = 0
  let totalQueueTime = 0
  let totalMoveTime = 0
  let totalLaborCost = 0
  let totalOverheadCost = 0
  
  for (const op of operations) {
    if (!op.is_active) continue
    
    totalSetupTime += op.standard_setup_time || 0
    totalRunTime += (op.standard_run_time_per_unit || 0) * quantity
    totalQueueTime += op.standard_queue_time || 0
    totalMoveTime += op.standard_move_time || 0
    
    const opTime = (op.standard_setup_time || 0) + ((op.standard_run_time_per_unit || 0) * quantity)
    const opTimeHours = opTime / 60
    
    totalLaborCost += opTimeHours * (op.labor_rate_per_hour || 0)
    totalOverheadCost += opTimeHours * (op.overhead_rate_per_hour || 0)
  }
  
  return {
    time: {
      total_setup_time: totalSetupTime,
      total_run_time: totalRunTime,
      total_queue_time: totalQueueTime,
      total_move_time: totalMoveTime,
      total_lead_time: totalSetupTime + totalRunTime + totalQueueTime + totalMoveTime
    },
    cost: {
      total_labor_cost: totalLaborCost,
      total_overhead_cost: totalOverheadCost,
      total_routing_cost: totalLaborCost + totalOverheadCost
    }
  }
}

// =====================================================
// Export default service object
// =====================================================

export const routingService = {
  // Routing CRUD
  getRoutings,
  getRoutingById,
  getRoutingsByItem,
  createRouting,
  updateRouting,
  deleteRouting,
  approveRouting,
  copyRouting,
  
  // Operation CRUD
  getRoutingOperations,
  getOperationById,
  createOperation,
  updateOperation,
  deleteOperation,
  reorderOperations,
  
  // Resource CRUD
  getOperationResources,
  addOperationResource,
  deleteOperationResource,
  
  // Calculations
  calculateRoutingTime,
  calculateRoutingCost,
  calculateRoutingTotals
}

export default routingService

