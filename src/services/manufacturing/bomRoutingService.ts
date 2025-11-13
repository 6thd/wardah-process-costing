/**
 * BOM Routing Service
 * خدمة إدارة عمليات التصنيع (Routing)
 */

import { supabase } from '@/lib/supabase'
import { getEffectiveTenantId } from '@/lib/supabase'

export interface BOMOperation {
  id?: string
  bom_id: string
  operation_sequence: number
  operation_code: string
  operation_name: string
  operation_description?: string
  work_center_id?: string
  setup_time_minutes: number
  run_time_minutes: number
  queue_time_minutes?: number
  move_time_minutes?: number
  labor_rate: number
  machine_rate?: number
  overhead_rate?: number
  setup_cost?: number
  run_cost_per_unit?: number
  total_cost_per_unit?: number
  tooling_required?: string
  skill_level_required?: string
  is_critical: boolean
  is_active: boolean
  org_id: string
  created_at?: string
  updated_at?: string
}

export interface BOMOperationMaterial {
  id?: string
  operation_id: string
  item_id: string
  quantity_required: number
  uom?: string
  issue_type: 'AUTO' | 'MANUAL' | 'BACKFLUSH'
  org_id: string
  created_at?: string
}

export interface RoutingCost {
  operation_sequence: number
  operation_code: string
  operation_name: string
  setup_cost: number
  run_cost: number
  total_cost: number
  total_time_minutes: number
}

export const bomRoutingService = {
  /**
   * الحصول على عمليات BOM
   */
  async getOperations(bomId: string): Promise<BOMOperation[]> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_operations')
      .select('*')
      .eq('bom_id', bomId)
      .eq('org_id', orgId)
      .order('operation_sequence', { ascending: true })

    if (error) throw error
    return data || []
  },

  /**
   * إضافة عملية
   */
  async addOperation(operation: Omit<BOMOperation, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_operations')
      .insert({
        ...operation,
        org_id: orgId
      })
      .select('id')
      .single()

    if (error) throw error
    return data.id
  },

  /**
   * تحديث عملية
   */
  async updateOperation(
    operationId: string,
    updates: Partial<BOMOperation>
  ): Promise<void> {
    const { error } = await supabase
      .from('bom_operations')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', operationId)

    if (error) throw error
  },

  /**
   * حذف عملية
   */
  async deleteOperation(operationId: string): Promise<void> {
    const { error } = await supabase
      .from('bom_operations')
      .delete()
      .eq('id', operationId)

    if (error) throw error
  },

  /**
   * حساب تكلفة Routing
   */
  async calculateRoutingCost(
    bomId: string,
    quantity: number = 1
  ): Promise<RoutingCost[]> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase.rpc('calculate_routing_cost', {
      p_bom_id: bomId,
      p_quantity: quantity,
      p_org_id: orgId
    })

    if (error) throw error
    return data || []
  },

  /**
   * حساب إجمالي تكلفة Routing
   */
  async calculateTotalRoutingCost(
    bomId: string,
    quantity: number = 1
  ): Promise<number> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase.rpc('calculate_total_routing_cost', {
      p_bom_id: bomId,
      p_quantity: quantity,
      p_org_id: orgId
    })

    if (error) throw error
    return data || 0
  },

  /**
   * الحصول على مواد العملية
   */
  async getOperationMaterials(operationId: string): Promise<BOMOperationMaterial[]> {
    const { data, error } = await supabase
      .from('bom_operation_materials')
      .select('*')
      .eq('operation_id', operationId)
      .order('item_id', { ascending: true })

    if (error) throw error
    return data || []
  },

  /**
   * إضافة مادة للعملية
   */
  async addOperationMaterial(material: Omit<BOMOperationMaterial, 'id' | 'created_at'>): Promise<string> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_operation_materials')
      .insert({
        ...material,
        org_id: orgId
      })
      .select('id')
      .single()

    if (error) throw error
    return data.id
  }
}

export default bomRoutingService

