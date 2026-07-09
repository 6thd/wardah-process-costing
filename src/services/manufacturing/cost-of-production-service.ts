import { supabase } from '@/lib/supabase'

/**
 * تقرير تكلفة الإنتاج بالوحدات المكافئة — الأنواع كما تُرجعها
 * rpc_cost_of_production_report (Migration 80)
 */

/** الخطوة 1: جدول الكميات */
export interface QuantitySchedule {
  wip_beginning_qty: number
  units_started: number
  units_to_account: number
  units_completed: number
  wip_ending_qty: number
  normal_scrap_qty: number
  abnormal_scrap_qty: number
  rework_qty: number
  units_accounted: number
  qty_difference: number
  is_balanced: boolean
}

/** الخطوة 2: الوحدات المكافئة */
export interface EquivalentUnits {
  eup_dm: number
  eup_cc: number
  wip_end_dm_completion_pct: number
  wip_end_cc_completion_pct: number
  wip_beg_dm_completion_pct: number
  wip_beg_cc_completion_pct: number
}

/** الخطوة 3: التكاليف الواجب حسابها */
export interface CostsToAccount {
  wip_beginning_cost: number
  transferred_in: number
  direct_materials: number
  direct_labor: number
  overhead_applied: number
  conversion_costs: number
  regrind_cost: number
  waste_credit: number
  total_costs_in: number
}

/** الخطوة 4: تكلفة الوحدة المكافئة */
export interface CostPerEU {
  transferred_in_per_eu: number
  dm_per_eu: number
  cc_per_eu: number
  total_per_eu: number
  stored_unit_cost: number
}

/** الخطوة 5أ: توزيع التكاليف */
export interface CostAssignment {
  completed_and_transferred: number
  ending_wip: number
  abnormal_scrap_loss: number
  normal_scrap_absorbed: number
  total_costs_out: number
}

/** الخطوة 5ب: التسوية */
export interface Reconciliation {
  costs_in: number
  costs_out: number
  difference: number
  is_balanced: boolean
  stored_total_cost: number
  stored_vs_computed_diff: number
}

export interface StageReport {
  stage_no: number
  work_center_id: string
  costing_method: 'weighted_average' | 'fifo'
  mode: string
  quantity_schedule: QuantitySchedule
  equivalent_units: EquivalentUnits
  costs_to_account: CostsToAccount
  cost_per_eu: CostPerEU
  cost_assignment: CostAssignment
  reconciliation: Reconciliation
}

export interface CostOfProductionReport {
  success: boolean
  report_type: 'cost_of_production'
  generated_at: string
  manufacturing_order: {
    id: string
    order_number: string
    product_id: string
    status: string
    qty_planned: number
  }
  stages: StageReport[]
  totals: {
    total_costs_in: number
    total_completed: number
    total_ending_wip: number
    total_abnormal_scrap_loss: number
    all_stages_balanced: boolean
  }
}

function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.message?.includes('Could not find the function') || false
}

const MIGRATION_80_HINT =
  'دالة تقرير تكلفة الإنتاج غير متاحة — طبّق Migration 80 (sql/migrations/80_cost_of_production_report.sql) أولاً'

/**
 * خدمة تقرير تكلفة الإنتاج — Cost of Production Report
 * قراءة فقط: لا تعدّل أي بيانات. تتطلب Migration 80 على قاعدة البيانات؛
 * ترجع رسالة عربية واضحة إن لم تكن مطبَّقة.
 */
export class CostOfProductionService {
  /**
   * توليد التقرير الكامل لأمر تصنيع (كل المراحل أو مرحلة محددة)
   */
  static async getReport(
    moId: string,
    stageNo?: number,
    tenantId?: string
  ): Promise<CostOfProductionReport> {
    if (!supabase) throw new Error('Supabase client not initialized')

    const { data, error } = await supabase.rpc('rpc_cost_of_production_report', {
      p_mo_id: moId,
      p_stage_no: stageNo ?? null,
      p_tenant: tenantId ?? null
    })

    if (error) {
      if (isMissingFunctionError(error)) throw new Error(MIGRATION_80_HINT)
      throw new Error(error.message)
    }
    if (!data) {
      throw new Error('لم تُرجع قاعدة البيانات تقريراً — تحقق من بيانات أمر التصنيع')
    }
    return data as CostOfProductionReport
  }

  /**
   * فحص سريع: هل كل مراحل الأمر متوازنة (كميات + تكاليف)؟
   * مفيد للتنبيهات قبل الإقفال
   */
  static async isFullyReconciled(moId: string, tenantId?: string): Promise<boolean> {
    const report = await CostOfProductionService.getReport(moId, undefined, tenantId)
    return report.totals.all_stages_balanced
  }
}

export const costOfProductionService = CostOfProductionService
