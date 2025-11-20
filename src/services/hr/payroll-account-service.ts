import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export type PayrollAccountType =
  | 'basic_salary'
  | 'housing_allowance'
  | 'transport_allowance'
  | 'other_allowance'
  | 'deductions'
  | 'loans'
  | 'payable'
  | 'net_payable';

export interface PayrollAccountMapping {
  id: string;
  org_id: string;
  account_type: PayrollAccountType;
  gl_account_id: string;
}

export interface GlAccountOption {
  id: string;
  code: string;
  name: string;
}

export async function listPostingAccounts(): Promise<GlAccountOption[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('gl_accounts')
    .select('id, code, name, org_id, allow_posting, is_active')
    .eq('is_active', true)
    .eq('org_id', orgId)
    .order('code', { ascending: true });

  if (error) {
    console.error('Failed to load GL accounts:', error);
    throw error;
  }

  return (data ?? []).map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name || account.code,
  }));
}

export async function getPayrollAccountMappings(): Promise<PayrollAccountMapping[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('hr_payroll_account_mappings')
    .select('*')
    .eq('org_id', orgId);

  if (error) {
    console.error('Failed to fetch payroll account mappings:', error);
    throw error;
  }

  return (data as PayrollAccountMapping[]) ?? [];
}

export async function upsertPayrollAccountMapping(
  account_type: PayrollAccountType,
  gl_account_id: string,
): Promise<PayrollAccountMapping> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const payload = {
    org_id: orgId,
    account_type,
    gl_account_id,
  };

  const { data, error } = await supabase
    .from('hr_payroll_account_mappings')
    .upsert(payload, { onConflict: 'org_id,account_type' })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to upsert payroll account mapping:', error);
    throw error;
  }

  return data as PayrollAccountMapping;
}

