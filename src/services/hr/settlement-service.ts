/**
 * محرّك نهاية الخدمة (P12-E) — مطابق لنظام العمل السعودي:
 * م109: نصف شهر × سنة لأول 5 سنوات + شهر كامل لما بعدها على كامل الحزمة.
 * مضاعِفات الاستقالة: <2 سنة=صفر، 2-5=ثلث، 5-10=ثلثان، ≥10=كامل.
 * م77 (فصل بلا سبب): كامل + تعويض شهر/سنة (حد أدنى شهرين).
 * م80 (مخالفة جسيمة): صفر.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { getLeaveBalance } from './leave-service';

// ─── أنواع ────────────────────────────────────────────────────────────────────

export type TerminationType =
  | 'resignation'
  | 'termination_without_cause'  // م77 — فصل بدون سبب مشروع
  | 'termination_for_cause'      // م80 — مخالفة جسيمة (لا مكافأة)
  | 'end_of_contract'
  | 'mutual_agreement'
  | 'retirement'
  | 'death';

export interface EosInput {
  basic: number;
  housing: number;
  transport: number;
  other_allowances: number;
  service_start: string;  // YYYY-MM-DD
  service_end: string;    // YYYY-MM-DD
  termination_type: TerminationType;
  leave_balance_days?: number;
}

export interface EosLine {
  component_code: string;
  component_label: string;
  calculation_basis: string;
  amount: number;
  is_deduction: boolean;
}

export interface EosResult {
  years_of_service: number;
  full_package: number;
  base_eos: number;
  eos_multiplier: number;
  eos_amount: number;
  leave_encashment: number;
  art77_compensation: number;
  total: number;
  lines: EosLine[];
}

export interface SettlementRow {
  id: string;
  org_id: string;
  employee_id: string;
  settlement_type: string;
  status: 'draft' | 'review' | 'approved' | 'paid' | 'rejected';
  service_start: string | null;
  service_end: string | null;
  service_days: number | null;
  calculated_amount: number;
  payable_amount: number;
  notes: string | null;
  created_at: string;
  employee?: { id: string; full_name: string; hire_date: string };
  lines?: EosLine[];
}

export interface CreateSettlementInput {
  employee_id: string;
  termination_type: TerminationType;
  service_end: string;  // YYYY-MM-DD
  notes?: string;
}

// ─── محرّك الحساب الصافي (لا DB) ─────────────────────────────────────────────

/**
 * سنوات الخدمة كعدد عشري من تاريخين.
 */
export function yearsOfServiceBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (365.25 * 86_400_000));
}

/**
 * مكافأة نهاية الخدمة الكاملة قبل تطبيق مضاعِف الاستقالة (م109):
 * نصف شهر/سنة لأول 5 سنوات + شهر/سنة لما بعدها على كامل الحزمة.
 */
export function computeBaseEos(fullPackage: number, yearsOfService: number): number {
  const tier1 = Math.min(yearsOfService, 5);
  const tier2 = Math.max(0, yearsOfService - 5);
  return fullPackage * (tier1 * 0.5 + tier2 * 1.0);
}

/**
 * مضاعِف الاستقالة (م109):
 * < 2 سنوات ⇒ 0، 2–5 ⇒ ثلث، 5–10 ⇒ ثلثان، ≥10 ⇒ كامل.
 */
export function resignationMultiplier(yearsOfService: number): number {
  if (yearsOfService < 2) return 0;
  if (yearsOfService < 5) return 1 / 3;
  if (yearsOfService < 10) return 2 / 3;
  return 1;
}

/**
 * تعويض الفصل التعسفي (م77): شهر/سنة، حد أدنى شهرين.
 */
export function computeArt77Compensation(fullPackage: number, yearsOfService: number): number {
  return fullPackage * Math.max(2, yearsOfService);
}

/**
 * الحساب الكامل لتسوية نهاية الخدمة — دالة صافية قابلة للاختبار.
 */
export function calcEos(input: EosInput): EosResult {
  const start = new Date(input.service_start);
  const end = new Date(input.service_end);
  const years = yearsOfServiceBetween(start, end);

  const fullPackage =
    input.basic + input.housing + input.transport + input.other_allowances;

  const baseEos = computeBaseEos(fullPackage, years);

  let eosMultiplier = 1;
  let art77 = 0;

  switch (input.termination_type) {
    case 'resignation':
      eosMultiplier = resignationMultiplier(years);
      break;
    case 'termination_for_cause': // م80 — لا مكافأة
      eosMultiplier = 0;
      break;
    case 'termination_without_cause': // م77
      eosMultiplier = 1;
      art77 = computeArt77Compensation(fullPackage, years);
      break;
    default: // end_of_contract, mutual_agreement, retirement, death
      eosMultiplier = 1;
  }

  const eosAmount = baseEos * eosMultiplier;
  const leaveDays = input.leave_balance_days ?? 0;
  const leaveEncashment = leaveDays > 0 ? (fullPackage / 30) * leaveDays : 0;
  const total = eosAmount + leaveEncashment + art77;

  const lines: EosLine[] = [];

  if (eosAmount > 0) {
    lines.push({
      component_code: 'GRATUITY',
      component_label: 'مكافأة نهاية الخدمة',
      calculation_basis: `${years.toFixed(2)} سنة × ×${eosMultiplier.toFixed(4)} على حزمة ${fullPackage.toFixed(0)} ريال/شهر`,
      amount: eosAmount,
      is_deduction: false,
    });
  }

  if (leaveEncashment > 0) {
    lines.push({
      component_code: 'LEAVE_ENCASH',
      component_label: 'صرف رصيد الإجازات',
      calculation_basis: `${leaveDays.toFixed(1)} يوم × ${(fullPackage / 30).toFixed(2)} ريال/يوم`,
      amount: leaveEncashment,
      is_deduction: false,
    });
  }

  if (art77 > 0) {
    lines.push({
      component_code: 'ART77_COMP',
      component_label: 'تعويض الفصل التعسفي (م77)',
      calculation_basis: `${Math.max(2, years).toFixed(2)} شهر × ${fullPackage.toFixed(0)} ريال`,
      amount: art77,
      is_deduction: false,
    });
  }

  return {
    years_of_service: years,
    full_package: fullPackage,
    base_eos: baseEos,
    eos_multiplier: eosMultiplier,
    eos_amount: eosAmount,
    leave_encashment: leaveEncashment,
    art77_compensation: art77,
    total,
    lines,
  };
}

// ─── خدمة DB ─────────────────────────────────────────────────────────────────

export async function listSettlements(limit = 100): Promise<SettlementRow[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('hr_settlements')
    .select(
      `id, org_id, employee_id, settlement_type, status,
       service_start, service_end, service_days,
       calculated_amount, payable_amount, notes, created_at,
       employee:employees(id, full_name, hire_date)`,
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SettlementRow[];
}

/**
 * إنشاء تسوية (draft): يحسب EOS ويحفظها مع سطور التفصيل.
 * الأرقام تُستخرج من employee_salary_structures.
 */
export async function createSettlement(
  input: CreateSettlementInput,
): Promise<{ settlement: SettlementRow; result: EosResult }> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  // جلب بيانات الموظف
  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select('id, full_name, hire_date')
    .eq('id', input.employee_id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (empErr) throw new Error(empErr.message);
  if (!emp) throw new Error('الموظف غير موجود');
  if (!emp.hire_date) throw new Error('تاريخ التعيين غير مسجَّل');

  // جلب مكوّنات الراتب
  const { data: components, error: compErr } = await supabase
    .from('employee_salary_structures')
    .select(
      `amount, calculation_type,
       component:salary_components(code, name)`,
    )
    .eq('employee_id', input.employee_id)
    .eq('org_id', orgId)
    .eq('is_active', true);

  if (compErr) throw new Error(compErr.message);

  let basic = 0, housing = 0, transport = 0, other = 0;
  for (const c of components ?? []) {
    const comp = Array.isArray(c.component) ? c.component[0] : c.component;
    const code: string = (comp?.code ?? '').toUpperCase();
    const amount = Number(c.amount);
    if (code === 'BASIC' || code === 'BASIC_SALARY') basic += amount;
    else if (code.includes('HOUSING') || code.includes('HOUSE')) housing += amount;
    else if (code.includes('TRANSPORT') || code.includes('TRAVEL')) transport += amount;
    else other += amount;
  }

  // رصيد الإجازات
  const leaveBal = await getLeaveBalance(input.employee_id);

  const eosResult = calcEos({
    basic,
    housing,
    transport,
    other_allowances: other,
    service_start: emp.hire_date,
    service_end: input.service_end,
    termination_type: input.termination_type,
    leave_balance_days: leaveBal.balance,
  });

  const serviceDays = Math.round(eosResult.years_of_service * 365.25);

  // حفظ التسوية
  const { data: settl, error: settlErr } = await supabase
    .from('hr_settlements')
    .insert({
      org_id: orgId,
      employee_id: input.employee_id,
      settlement_type: input.termination_type,
      status: 'draft',
      service_start: emp.hire_date,
      service_end: input.service_end,
      service_days: serviceDays,
      calculated_amount: eosResult.total,
      payable_amount: eosResult.total,
      notes: input.notes ?? null,
    })
    .select('*')
    .single();

  if (settlErr) throw new Error(settlErr.message);

  // حفظ سطور التفصيل
  if (eosResult.lines.length > 0) {
    const lineRows = eosResult.lines.map((l) => ({
      org_id: orgId,
      settlement_id: settl.id,
      component_code: l.component_code,
      component_label: l.component_label,
      calculation_basis: l.calculation_basis,
      amount: l.amount,
      is_deduction: l.is_deduction,
    }));

    const { error: lineErr } = await supabase
      .from('hr_settlement_lines')
      .insert(lineRows);

    if (lineErr) throw new Error(lineErr.message);
  }

  return { settlement: settl as SettlementRow, result: eosResult };
}

/**
 * ترحيل التسوية ذرّياً عبر rpc_post_settlement (Migration 100).
 * يقلب حالة الموظف إلى terminated ويُنشئ قيد GL.
 */
export async function postSettlement(settlementId: string): Promise<void> {
  const idempotencyKey = `settlement:${settlementId}`;

  const { data, error } = await supabase.rpc('rpc_post_settlement', {
    p_payload: { idempotency_key: idempotencyKey, settlement_id: settlementId },
  });

  if (error) {
    // PGRST202 = function doesn't exist (pre-migration environment)
    if (error.code === 'PGRST202') {
      throw new Error(
        'دالة rpc_post_settlement غير موجودة — يرجى تطبيق Migration 100 أولاً',
      );
    }
    throw new Error(error.message);
  }

  const msg = typeof data === 'string' ? data : data?.status;
  if (msg && msg !== 'approved') {
    throw new Error(`فشل ترحيل التسوية: ${msg}`);
  }
}

/**
 * إلغاء تسوية (draft/review فقط).
 */
export async function cancelSettlement(settlementId: string): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { error } = await supabase
    .from('hr_settlements')
    .update({ status: 'rejected' })
    .eq('id', settlementId)
    .eq('org_id', orgId)
    .in('status', ['draft', 'review']);

  if (error) throw new Error(error.message);
}
