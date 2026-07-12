/**
 * تعديلات الرواتب الشهرية (hr_payroll_adjustments) — سلف/جزاءات/عمولات/أقساط
 * قروض لكل موظف/شهر، منفصلة عن بيانات الموظف الرئيسية (فكرة حاسبني الصحيحة
 * في salaries_{y}_{m}). recurring يسري كل شهر؛ غيره يسري في effective_month فقط.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export type AdjustmentType = 'allowance' | 'deduction' | 'loan' | 'gosi' | 'overtime';

export interface PayrollAdjustment {
  id: string;
  org_id: string;
  payroll_run_id: string | null;
  employee_id: string | null;
  adjustment_type: AdjustmentType;
  description: string | null;
  amount: number;
  is_recurring: boolean;
  effective_month: string | null; // YYYY-MM-01
}

export interface AdjustmentInput {
  employee_id: string;
  adjustment_type: AdjustmentType;
  description?: string;
  amount: number;
  is_recurring?: boolean;
  effective_month?: string; // YYYY-MM
}

const monthStart = (ym: string) => `${ym}-01`;

/** تعديلات شهر: recurring دائماً + غير المتكرر المطابق للشهر. */
export async function listAdjustmentsForMonth(
  year: number,
  month: number,
): Promise<PayrollAdjustment[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('hr_payroll_adjustments')
    .select('*')
    .eq('org_id', orgId)
    .or(`is_recurring.eq.true,effective_month.eq.${monthStart(ym)}`);

  if (error) throw new Error(error.message);
  return (data ?? []) as PayrollAdjustment[];
}

export async function createAdjustment(input: AdjustmentInput): Promise<PayrollAdjustment> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');
  if (!input.amount || input.amount <= 0) throw new Error('المبلغ يجب أن يكون موجباً');

  const { data, error } = await supabase
    .from('hr_payroll_adjustments')
    .insert({
      org_id: orgId,
      employee_id: input.employee_id,
      adjustment_type: input.adjustment_type,
      description: input.description ?? null,
      amount: input.amount,
      is_recurring: input.is_recurring ?? false,
      effective_month: input.effective_month ? monthStart(input.effective_month) : null,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as PayrollAdjustment;
}

export async function deleteAdjustment(id: string): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { error } = await supabase
    .from('hr_payroll_adjustments')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) throw new Error(error.message);
}
