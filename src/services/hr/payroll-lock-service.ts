import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export type PayrollLockStatus = 'generated' | 'paid' | 'locked';

export interface PayrollLock {
  id: string;
  org_id: string;
  year: number;
  month: number;
  status: PayrollLockStatus;
  locked_at?: string | null;
  locked_by?: string | null;
  journal_entry_id?: string | null;
  notes?: string | null;
}

const normalizePeriod = (year: number, month: number) => {
  if (month < 1 || month > 12) {
    throw new Error('Month must be between 1 and 12.');
  }
  return { year, month };
};

export async function getPayrollLock(
  year: number,
  month: number,
): Promise<PayrollLock | null> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  normalizePeriod(year, month);

  const { data, error } = await supabase
    .from('hr_payroll_locks')
    .select('*')
    .eq('org_id', orgId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch payroll lock:', error);
    throw error;
  }

  return (data as PayrollLock) ?? null;
}

export async function upsertPayrollLock(
  year: number,
  month: number,
  status: PayrollLockStatus,
  options: { journal_entry_id?: string | null; notes?: string | null } = {},
): Promise<PayrollLock> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');
  normalizePeriod(year, month);

  const payload = {
    org_id: orgId,
    year,
    month,
    status,
    journal_entry_id: options.journal_entry_id ?? null,
    notes: options.notes ?? null,
    locked_at: status === 'locked' ? new Date().toISOString() : null,
  };

  const { data, error } = await supabase
    .from('hr_payroll_locks')
    .upsert(payload, { onConflict: 'org_id,year,month' })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to update payroll lock status:', error);
    throw error;
  }

  return data as PayrollLock;
}

export async function ensurePayrollUnlocked(year: number, month: number) {
  const lock = await getPayrollLock(year, month);
  if (lock?.status === 'locked') {
    throw new Error('The selected payroll month is locked.');
  }
}

