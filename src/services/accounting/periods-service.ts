import { supabase } from '@/lib/supabase'

/**
 * Accounting Period — كما تُرجعها rpc_list_periods
 */
export interface AccountingPeriod {
  id: string
  period_code: string
  period_name: string
  period_type: 'month' | 'quarter' | 'year'
  start_date: string
  end_date: string
  fiscal_year: number
  status: 'open' | 'closed' | 'permanently_closed'
}

export interface SetPeriodStatusResult {
  success: boolean
  period_code: string
  previous_status?: string
  status: string
  changed: boolean
}

export interface GeneratePeriodsResult {
  success: boolean
  fiscal_year: number
  periods_created: number
  periods_existing: number
}

function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.message?.includes('Could not find the function') || false
}

const MIGRATION_79_HINT =
  'دوال إدارة الفترات غير متاحة — طبّق Migration 79 (sql/migrations/79_p1_period_enforcement_and_management.sql) أولاً'

/**
 * Periods Service — إدارة الفترات المحاسبية
 * يتطلب Migration 79 على قاعدة البيانات؛ يرجع رسالة عربية واضحة إن لم يُطبَّق
 */
export class PeriodsService {
  /**
   * قائمة الفترات (اختيارياً لسنة مالية محددة)
   */
  static async listPeriods(fiscalYear?: number, tenantId?: string): Promise<AccountingPeriod[]> {
    if (!supabase) throw new Error('Supabase client not initialized')
    const { data, error } = await supabase.rpc('rpc_list_periods', {
      p_fiscal_year: fiscalYear ?? null,
      p_tenant: tenantId ?? null
    })

    if (error) {
      if (isMissingFunctionError(error)) throw new Error(MIGRATION_79_HINT)
      throw new Error(error.message)
    }
    return (data ?? []) as AccountingPeriod[]
  }

  /**
   * توليد 12 فترة شهرية لسنة مالية — آمن للتكرار (الموجود لا يُمس)
   */
  static async generateFiscalPeriods(year: number, tenantId?: string): Promise<GeneratePeriodsResult> {
    if (!supabase) throw new Error('Supabase client not initialized')
    const { data, error } = await supabase.rpc('rpc_generate_fiscal_periods', {
      p_year: year,
      p_tenant: tenantId ?? null
    })

    if (error) {
      if (isMissingFunctionError(error)) throw new Error(MIGRATION_79_HINT)
      throw new Error(error.message)
    }
    return data as GeneratePeriodsResult
  }

  /**
   * إقفال فترة — أي قيد/ترحيل بتاريخ داخلها سيُرفض بـ PERIOD_CLOSED
   */
  static async closePeriod(periodCode: string, tenantId?: string): Promise<SetPeriodStatusResult> {
    return this.setPeriodStatus(periodCode, 'closed', tenantId)
  }

  /**
   * إعادة فتح فترة مقفلة (لا تعمل مع permanently_closed)
   */
  static async reopenPeriod(periodCode: string, tenantId?: string): Promise<SetPeriodStatusResult> {
    return this.setPeriodStatus(periodCode, 'open', tenantId)
  }

  /**
   * إقفال نهائي — لا رجعة فيه (PERIOD_LOCKED عند أي محاولة تغيير لاحقة)
   */
  static async permanentlyClosePeriod(periodCode: string, tenantId?: string): Promise<SetPeriodStatusResult> {
    return this.setPeriodStatus(periodCode, 'permanently_closed', tenantId)
  }

  /**
   * تغيير حالة فترة مباشرة
   */
  static async setPeriodStatus(
    periodCode: string,
    status: 'open' | 'closed' | 'permanently_closed',
    tenantId?: string
  ): Promise<SetPeriodStatusResult> {
    if (!supabase) throw new Error('Supabase client not initialized')
    const { data, error } = await supabase.rpc('rpc_set_period_status', {
      p_period_code: periodCode,
      p_status: status,
      p_tenant: tenantId ?? null
    })

    if (error) {
      if (isMissingFunctionError(error)) throw new Error(MIGRATION_79_HINT)
      throw new Error(error.message)
    }
    return data as SetPeriodStatusResult
  }
}

export default PeriodsService
