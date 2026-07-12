import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface HrPolicies {
  id: string;
  org_id: string;
  employee_daily_hours: number;
  worker_daily_hours: number;
  worker_shifts: number;
  weekend_days: string[];
  overtime_multiplier: number;
  overtime_grace_minutes: number;
  // سياسات GOSI/الرواتب (Migration 99 — قابلة للتعديل من شاشة الضبط)
  gosi_employee_pct: number;
  gosi_employer_pct: number;
  gosi_base_cap: number;
  gosi_applies_to: 'saudi_only' | 'all' | 'none';
  daily_rate_basis: 'working_days' | 'thirty';
  overtime_base: 'basic' | 'basic_housing';
  // استحقاق الإجازات (نظام العمل م109)
  annual_leave_days_before_5y: number;
  annual_leave_days_after_5y: number;
  include_weekends_in_accrual: boolean;
  exclude_unpaid_from_accrual: boolean;
}

const DEFAULT_POLICIES: HrPolicies = {
  id: '',
  org_id: '',
  employee_daily_hours: 8,
  worker_daily_hours: 11,
  worker_shifts: 2,
  weekend_days: ['friday'],
  overtime_multiplier: 1.5,
  overtime_grace_minutes: 0,
  gosi_employee_pct: 9.75,
  gosi_employer_pct: 11.75,
  gosi_base_cap: 45000,
  gosi_applies_to: 'saudi_only',
  daily_rate_basis: 'working_days',
  overtime_base: 'basic',
  annual_leave_days_before_5y: 21,
  annual_leave_days_after_5y: 30,
  include_weekends_in_accrual: true,
  exclude_unpaid_from_accrual: true,
};

export async function getHrPolicies(): Promise<HrPolicies> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found for current user.');

  const { data, error } = await supabase
    .from('hr_policies')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load HR policies:', error);
    throw error;
  }

  if (!data) {
    const { data: inserted, error: insertError } = await supabase
      .from('hr_policies')
      .insert({ org_id: orgId })
      .select('*')
      .single();

    if (insertError) {
      console.error('Failed to create default HR policies:', insertError);
      throw insertError;
    }
    return inserted as HrPolicies;
  }

  return data as HrPolicies;
}

export async function updateHrPolicies(partial: Partial<HrPolicies>): Promise<HrPolicies> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found for current user.');

  const payload = {
    ...DEFAULT_POLICIES,
    ...partial,
    org_id: orgId,
  };

  const { data, error } = await supabase
    .from('hr_policies')
    .upsert(payload, {
      onConflict: 'org_id',
    })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to update HR policies:', error);
    throw error;
  }

  return data as HrPolicies;
}

