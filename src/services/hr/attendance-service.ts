import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface AttendanceDayPayload {
  status: string;
  in?: string | null;
  out?: string | null;
  notes?: string | null;
  source?: string | null;
}

export interface MonthlyAttendance {
  id: string;
  org_id: string;
  employee_id: string;
  year: number;
  month: number;
  days: Record<string, AttendanceDayPayload>;
}

const buildPeriodKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`;

export async function getMonthlyAttendance(
  employeeId: string,
  year: number,
  month: number,
): Promise<MonthlyAttendance | null> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('hr_attendance_monthly')
    .select('*')
    .eq('org_id', orgId)
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch monthly attendance:', error);
    throw error;
  }

  return (data as MonthlyAttendance) ?? null;
}

async function ensurePeriodIsUnlocked(year: number, month: number) {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('hr_payroll_locks')
    .select('status')
    .eq('org_id', orgId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (error) {
    console.error('Failed to check payroll lock status:', error);
    throw error;
  }

  if (data && data.status === 'locked') {
    throw new Error('Cannot edit attendance. Payroll is locked for this month.');
  }
}

export async function setDayStatus(
  employeeId: string,
  date: string,
  payload: AttendanceDayPayload,
): Promise<MonthlyAttendance> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const parsed = new Date(date);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = String(parsed.getUTCDate());

  await ensurePeriodIsUnlocked(year, month);

  const { data, error } = await supabase.rpc('upsert_attendance_day', {
    p_org_id: orgId,
    p_employee_id: employeeId,
    p_year: year,
    p_month: month,
    p_day: day,
    p_payload: payload,
  });

  if (error) {
    console.error('Failed to update attendance day:', error);
    throw error;
  }

  return data as MonthlyAttendance;
}

/**
 * Fallback path if RPC is not available. Performs client-side JSON merge.
 */
export async function setDayStatusFallback(
  employeeId: string,
  date: string,
  payload: AttendanceDayPayload,
): Promise<MonthlyAttendance> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const parsed = new Date(date);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = String(parsed.getUTCDate());

  await ensurePeriodIsUnlocked(year, month);

  const existing = await getMonthlyAttendance(employeeId, year, month);
  const days = existing?.days ?? {};

  const updatedDays = {
    ...days,
    [day]: { ...payload, source: payload.source ?? 'manual' },
  };

  const upsertPayload = {
    org_id: orgId,
    employee_id: employeeId,
    year,
    month,
    days: updatedDays,
  };

  const { data, error } = await supabase
    .from('hr_attendance_monthly')
    .upsert(upsertPayload, { onConflict: 'org_id,employee_id,year,month' })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to upsert attendance monthly record:', error);
    throw error;
  }

  return data as MonthlyAttendance;
}

export async function listAttendanceForPeriod(
  employeeIds: string[],
  year: number,
  month: number,
): Promise<MonthlyAttendance[]> {
  if (!employeeIds.length) return [];
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('hr_attendance_monthly')
    .select('*')
    .eq('org_id', orgId)
    .in('employee_id', employeeIds)
    .eq('year', year)
    .eq('month', month);

  if (error) {
    console.error('Failed to list attendance records:', error);
    throw error;
  }

  return (data as MonthlyAttendance[]) ?? [];
}

