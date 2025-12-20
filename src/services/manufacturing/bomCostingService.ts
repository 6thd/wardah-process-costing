/**
 * BOM Costing Service - Enhanced
 * خدمة حساب تكلفة BOM المحسّنة
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase'

export interface BOMCostAnalysis {
  id: string
  bom_id: string
  analysis_date: string
  quantity: number
  standard_material_cost: number
  standard_labor_cost: number
  standard_overhead_cost: number
  standard_total_cost: number
  standard_unit_cost: number
  actual_material_cost: number
  actual_labor_cost: number
  actual_overhead_cost: number
  actual_total_cost: number
  actual_unit_cost: number
  material_variance: number
  labor_variance: number
  overhead_variance: number
  total_variance: number
  material_variance_pct: number
  labor_variance_pct: number
  status: 'DRAFT' | 'APPROVED' | 'ARCHIVED'
  notes?: string
  org_id: string
  created_at?: string
  updated_at?: string
}

export interface BOMCostComparison {
  cost_type: string
  standard_cost: number
  actual_cost: number
  variance: number
  variance_pct: number
}

export interface BOMCostDetails {
  id: string
  cost_analysis_id: string
  item_id: string
  level_number: number
  quantity_required: number
  standard_unit_cost: number
  standard_total_cost: number
  actual_unit_cost: number
  actual_total_cost: number
  variance: number
  variance_pct: number
}

export const bomCostingService = {
  /**
   * حساب التكلفة المعيارية
   */
  async calculateStandardCost(
    bomId: string,
    quantity: number = 1
  ): Promise<{
    material_cost: number
    labor_cost: number
    overhead_cost: number
    total_cost: number
    unit_cost: number
  }> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase.rpc('calculate_bom_standard_cost', {
      p_bom_id: bomId,
      p_quantity: quantity,
      p_org_id: orgId
    })

    if (error) throw error
    return data?.[0] || {
      material_cost: 0,
      labor_cost: 0,
      overhead_cost: 0,
      total_cost: 0,
      unit_cost: 0
    }
  },

  /**
   * مقارنة التكاليف
   */
  async compareCosts(
    bomId: string,
    quantity: number = 1
  ): Promise<BOMCostComparison[]> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase.rpc('compare_bom_costs', {
      p_bom_id: bomId,
      p_quantity: quantity,
      p_org_id: orgId
    })

    if (error) throw error
    return data || []
  },

  /**
   * إنشاء تحليل تكلفة
   */
  async createCostAnalysis(
    analysis: Omit<BOMCostAnalysis, 'id' | 'created_at' | 'updated_at' | 'org_id'>
  ): Promise<string> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_cost_analysis')
      .insert({
        ...analysis,
        org_id: orgId
      })
      .select('id')
      .single()

    if (error) throw error
    return data.id
  },

  /**
   * الحصول على تحليلات التكلفة
   */
  async getCostAnalyses(
    bomId: string,
    limit: number = 10
  ): Promise<BOMCostAnalysis[]> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) throw new Error('Organization ID not found')

    const { data, error } = await supabase
      .from('bom_cost_analysis')
      .select('*')
      .eq('bom_id', bomId)
      .eq('org_id', orgId)
      .order('analysis_date', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data || []
  },

  /**
   * الحصول على تفاصيل التكلفة
   */
  async getCostDetails(
    costAnalysisId: string
  ): Promise<BOMCostDetails[]> {
    const { data, error } = await supabase
      .from('bom_cost_details')
      .select('*')
      .eq('cost_analysis_id', costAnalysisId)
      .order('level_number', { ascending: true })

    if (error) throw error
    return data || []
  },

  /**
   * تحديث تحليل التكلفة
   */
  async updateCostAnalysis(
    analysisId: string,
    updates: Partial<BOMCostAnalysis>
  ): Promise<void> {
    const { error } = await supabase
      .from('bom_cost_analysis')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', analysisId)

    if (error) throw error
  },

  /**
   * الموافقة على تحليل التكلفة
   */
  async approveCostAnalysis(analysisId: string): Promise<void> {
    await this.updateCostAnalysis(analysisId, { status: 'APPROVED' })
  }
}

export default bomCostingService

