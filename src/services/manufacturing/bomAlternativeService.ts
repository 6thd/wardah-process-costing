/**
 * BOM Alternative Service
 * خدمة إدارة BOMs البديلة
 */

import { supabase } from '@/lib/supabase'
import { getEffectiveTenantId } from '@/lib/supabase'

export interface BOMAlternative {
  id?: string
  primary_bom_id: string
  alternative_bom_id: string
  priority: number
  is_default: boolean
  min_quantity?: number
  max_quantity?: number
  effective_from?: string
  effective_to?: string
  reason_code?: 'COST' | 'AVAILABILITY' | 'QUALITY' | 'SUPPLIER' | 'CUSTOM'
  reason_description?: string
  cost_difference?: number
  cost_difference_pct?: number
  is_active: boolean
  org_id: string
  created_at?: string
  updated_at?: string
}

export interface BOMSelectionRule {
  id?: string
  org_id: string
  rule_name: string
  rule_type: 'QUANTITY' | 'DATE' | 'COST' | 'AVAILABILITY' | 'SUPPLIER' | 'CUSTOM'
  condition_json: Record<string, any>
  priority: number
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export const bomAlternativeService = {
  /**
   * الحصول على BOMs البديلة
   */
  async getAlternatives(primaryBomId: string): Promise<BOMAlternative[]> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_alternatives')
      .select('*')
      .eq('primary_bom_id', primaryBomId)
      .eq('org_id', orgId)
      .order('priority', { ascending: true })

    if (error) throw error
    return data || []
  },

  /**
   * إضافة BOM بديل
   */
  async addAlternative(alternative: Omit<BOMAlternative, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_alternatives')
      .insert({
        ...alternative,
        org_id: orgId
      })
      .select('id')
      .single()

    if (error) throw error
    return data.id
  },

  /**
   * تحديث BOM بديل
   */
  async updateAlternative(
    alternativeId: string,
    updates: Partial<BOMAlternative>
  ): Promise<void> {
    const { error } = await supabase
      .from('bom_alternatives')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', alternativeId)

    if (error) throw error
  },

  /**
   * حذف BOM بديل
   */
  async deleteAlternative(alternativeId: string): Promise<void> {
    const { error } = await supabase
      .from('bom_alternatives')
      .delete()
      .eq('id', alternativeId)

    if (error) throw error
  },

  /**
   * اختيار BOM الأمثل
   */
  async selectOptimalBOM(
    itemId: string,
    quantity: number,
    orderDate?: string
  ): Promise<string> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase.rpc('select_optimal_bom', {
      p_item_id: itemId,
      p_quantity: quantity,
      p_order_date: orderDate || new Date().toISOString().split('T')[0],
      p_org_id: orgId
    })

    if (error) throw error
    return data
  },

  /**
   * الحصول على قواعد الاختيار
   */
  async getSelectionRules(): Promise<BOMSelectionRule[]> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_selection_rules')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('priority', { ascending: true })

    if (error) throw error
    return data || []
  },

  /**
   * إضافة قاعدة اختيار
   */
  async addSelectionRule(rule: Omit<BOMSelectionRule, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_selection_rules')
      .insert({
        ...rule,
        org_id: orgId
      })
      .select('id')
      .single()

    if (error) throw error
    return data.id
  },

  /**
   * تحديث قاعدة اختيار
   */
  async updateSelectionRule(
    ruleId: string,
    updates: Partial<BOMSelectionRule>
  ): Promise<void> {
    const { error } = await supabase
      .from('bom_selection_rules')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', ruleId)

    if (error) throw error
  }
}

export default bomAlternativeService

