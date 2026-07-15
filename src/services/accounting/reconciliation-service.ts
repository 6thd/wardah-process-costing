import { supabase as _supabase } from '@/lib/supabase'
const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

/**
 * تسوية الدفاتر الفرعية مع الأستاذ العام — الأنواع كما تُرجعها
 * rpc_subledger_gl_reconciliation (Migration 81)
 */

export interface GLAccountBalance {
  code: string
  name: string
  balance: number
}

export type SectionStatus = 'balanced' | 'unbalanced' | 'gl_unavailable' | 'subledger_unavailable'

export interface ReconciliationSection {
  section: 'inventory' | 'wip'
  title_ar: string
  gl_prefixes: string[]
  gl_balance: number | null
  gl_accounts: GLAccountBalance[]
  subledger_balance: number | null
  subledger_source: string | null
  open_mo_count?: number
  difference: number | null
  is_balanced: boolean
  status: SectionStatus
}

export interface ReconciliationReport {
  success: boolean
  report_type: 'subledger_gl_reconciliation'
  as_of_date: string
  generated_at: string
  gl_available: boolean
  sections: ReconciliationSection[]
  all_balanced: boolean
}

function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.message?.includes('Could not find the function') || false
}

const MIGRATION_81_HINT =
  'دالة التسوية غير متاحة — طبّق Migration 81 (sql/migrations/81_subledger_gl_reconciliation.sql) أولاً'

/**
 * خدمة تسوية الدفاتر الفرعية مع GL
 * قراءة فقط: تقارن أرصدة المخزون وWIP الفرعية مع حسابات الأستاذ العام
 * وتكشف أي قيد يدوي شارد أو ترحيل ناقص فوراً بدلاً من نهاية السنة
 */
export class ReconciliationService {
  /**
   * توليد تقرير التسوية حتى تاريخ معيّن (افتراضياً: اليوم)
   */
  static async getReport(asOfDate?: string, tenantId?: string): Promise<ReconciliationReport> {
    if (!supabase) throw new Error('Supabase client not initialized')

    const { data, error } = await supabase.rpc('rpc_subledger_gl_reconciliation', {
      p_as_of_date: asOfDate ?? new Date().toISOString().slice(0, 10),
      p_tenant: tenantId ?? null
    })

    if (error) {
      if (isMissingFunctionError(error)) throw new Error(MIGRATION_81_HINT)
      throw new Error(error.message)
    }
    if (!data) {
      throw new Error('لم تُرجع قاعدة البيانات تقرير تسوية')
    }
    return data as ReconciliationReport
  }

  /**
   * فحص سريع للوحات التحكم: هل كل الأقسام متوازنة؟
   */
  static async isBalanced(asOfDate?: string, tenantId?: string): Promise<boolean> {
    const report = await ReconciliationService.getReport(asOfDate, tenantId)
    return report.all_balanced
  }
}

export const reconciliationService = ReconciliationService
