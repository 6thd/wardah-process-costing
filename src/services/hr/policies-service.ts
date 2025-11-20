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

