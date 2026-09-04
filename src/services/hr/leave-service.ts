import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { setDayStatusFallback } from './attendance-service';
import {
  getHrPoliciesReadOnly,
  type HrPolicies,
} from './policies-service';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  leave_type_id: string;
  status: string;
}

export interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  is_paid: boolean;
  max_days_per_year: number | null;
}

export interface LeaveRequestRow {
  id: string;
  org_id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  notes: string | null;
  created_at: string;
  leave_type?: LeaveTypeRow;
  employee?: { id: string; full_name: string };
}

export interface LeaveRequestInput {
  employee_id: string;
  leave_type_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  reason?: string;
}

export interface LeaveBalanceResult {
  entitlementPerYear: number;
  accrued: number;
  used: number;
  balance: number;
  referenceDate: string; // ISO date from which accrual is counted
}

// ─── Pure functions (testable without DB) ────────────────────────────────────

/** Annual entitlement per Saudi Labor Law Art.109: 21 days < 5 yrs, 30 days ≥ 5 yrs. */
export function computeLeaveEntitlement(
  yearsOfService: number,
  policies: Pick<HrPolicies, 'annual_leave_days_before_5y' | 'annual_leave_days_after_5y'>,
): number {
  return yearsOfService >= 5
    ? policies.annual_leave_days_after_5y
    : policies.annual_leave_days_before_5y;
}

/**
 * Prorated accrual: (daysElapsed / 365) × entitlementPerYear.
 * Returns a number floored to 1 decimal.
 */
export function computeLeaveAccrual(
  referenceDate: Date,
  asOfDate: Date,
  entitlementPerYear: number,
): number {
  const daysElapsed = Math.max(
    0,
    (asOfDate.getTime() - referenceDate.getTime()) / 86_400_000,
  );
  return Math.floor((daysElapsed / 365) * entitlementPerYear * 10) / 10;
}

/** Remaining balance = accrued - used (floored to 0). */
export function computeLeaveBalance(accrued: number, usedDays: number): number {
  return Math.max(0, accrued - usedDays);
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────

export async function getLeaveTypes(): Promise<LeaveTypeRow[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('leave_types')
    .select('id, code, name, name_ar, is_paid, max_days_per_year')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as LeaveTypeRow[];
}

export async function listLeaveRequests(
  limit = 100,
): Promise<LeaveRequestRow[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('employee_leaves')
    .select(
      `id, org_id, employee_id, leave_type_id, start_date, end_date,
       total_days, reason, status, notes, created_at,
       leave_type:leave_types(id, code, name, name_ar, is_paid),
       employee:employees(id, full_name)`,
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeaveRequestRow[];
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export async function createLeaveRequest(
  input: LeaveRequestInput,
): Promise<LeaveRequestRow> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const start = new Date(input.start_date);
  const end = new Date(input.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('تواريخ الإجازة غير صالحة');
  }
  if (end < start) throw new Error('تاريخ الانتهاء قبل تاريخ البداية');

  const totalDays =
    Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const { data, error } = await supabase
    .from('employee_leaves')
    .insert({
      org_id: orgId,
      employee_id: input.employee_id,
      leave_type_id: input.leave_type_id,
      start_date: input.start_date,
      end_date: input.end_date,
      total_days: totalDays,
      reason: input.reason ?? null,
      status: 'pending',
    })
    .select(
      `id, org_id, employee_id, leave_type_id, start_date, end_date,
       total_days, reason, status, notes, created_at`,
    )
    .single();

  if (error) throw new Error(error.message);
  return data as LeaveRequestRow;
}

/**
 * Approve a pending leave request.
 * Fetches the leave type to determine if it is paid; checks accrued balance
 * if paid annual leave (unless adminOverride is set).
 * Then updates status → 'approved' and stamps attendance via
 * applyApprovedLeaveToAttendance.
 */
export async function approveLeaveRequest(
  leaveId: string,
  adminOverride = false,
): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data: leave, error: fetchErr } = await supabase
    .from('employee_leaves')
    .select(
      `id, employee_id, leave_type_id, total_days, status,
       leave_type:leave_types(id, code, is_paid)`,
    )
    .eq('id', leaveId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (fetchErr) throw new Error(fetchErr.message);
  if (!leave) throw new Error('طلب الإجازة غير موجود');
  if (leave.status !== 'pending') throw new Error('الطلب ليس في حالة انتظار');

  const leaveType = Array.isArray(leave.leave_type)
    ? leave.leave_type[0]
    : leave.leave_type;

  // Balance check for paid annual/regular leave
  if (leaveType?.is_paid && !adminOverride) {
    const bal = await getLeaveBalance(leave.employee_id);
    if (bal.balance < leave.total_days) {
      throw new Error(
        `رصيد الإجازة غير كافٍ (المتبقي ${bal.balance.toFixed(1)} يوم، المطلوب ${leave.total_days})`,
      );
    }
  }

  const { error: updateErr } = await supabase
    .from('employee_leaves')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', leaveId)
    .eq('org_id', orgId);

  if (updateErr) throw new Error(updateErr.message);

  await applyApprovedLeaveToAttendance(leaveId);
}

export async function rejectLeaveRequest(
  leaveId: string,
  notes: string,
): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  if (!notes?.trim()) throw new Error('يرجى إدخال سبب الرفض');

  const { error } = await supabase
    .from('employee_leaves')
    .update({ status: 'rejected', notes })
    .eq('id', leaveId)
    .eq('org_id', orgId);

  if (error) throw new Error(error.message);
}

/**
 * Compute the leave balance for an employee.
 * Reference date = hire_date (or the latest approved settlement's service_end if later).
 * Accrual is prorated; used days = total_days of approved paid leaves since referenceDate.
 */
type LeaveBalanceRow = {
  employee_id: string;
  start_date: string;
  total_days: number;
  leave_type: { is_paid: boolean } | Array<{ is_paid: boolean }> | null;
};

type LeaveBalanceEmployee = {
  id: string;
  hire_date: string;
};

type LeaveSettlementRow = {
  employee_id: string;
  service_end: string | null;
};

function latestSettlementsByEmployee(
  settlements: LeaveSettlementRow[],
): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const settlement of settlements) {
    if (!settlement.service_end) continue;
    const serviceEnd = new Date(settlement.service_end);
    const current = latest.get(settlement.employee_id);
    if (!current || serviceEnd > current) latest.set(settlement.employee_id, serviceEnd);
  }
  return latest;
}

function leavesByEmployee(
  leaves: LeaveBalanceRow[],
): Map<string, LeaveBalanceRow[]> {
  const indexed = new Map<string, LeaveBalanceRow[]>();
  for (const leave of leaves) {
    const rows = indexed.get(leave.employee_id) ?? [];
    rows.push(leave);
    indexed.set(leave.employee_id, rows);
  }
  return indexed;
}

function calculateEmployeeLeaveBalance(
  employee: LeaveBalanceEmployee,
  settlementWatermark: Date | undefined,
  leaves: LeaveBalanceRow[],
  policies: HrPolicies,
  now: Date,
): LeaveBalanceResult {
  const hireDate = new Date(employee.hire_date);
  const referenceDate = settlementWatermark && settlementWatermark > hireDate
    ? settlementWatermark
    : hireDate;
  const yearsOfService =
    (now.getTime() - hireDate.getTime()) / (365.25 * 86_400_000);
  const entitlementPerYear = computeLeaveEntitlement(yearsOfService, policies);
  const accrued = computeLeaveAccrual(referenceDate, now, entitlementPerYear);
  const used = leaves.reduce((sum, leave) => {
    const leaveType = Array.isArray(leave.leave_type)
      ? leave.leave_type[0]
      : leave.leave_type;
    return leaveType?.is_paid && new Date(leave.start_date) >= referenceDate
      ? sum + leave.total_days
      : sum;
  }, 0);

  return {
    entitlementPerYear,
    accrued,
    used,
    balance: computeLeaveBalance(accrued, used),
    referenceDate: referenceDate.toISOString().split('T')[0],
  };
}

export async function listLeaveBalances(
  employeeIds: string[],
  suppliedOrgId?: string,
): Promise<Map<string, LeaveBalanceResult>> {
  if (!employeeIds.length) return new Map();

  const orgId = suppliedOrgId ?? await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const [employeesResult, settlementsResult, leavesResult, policies] =
    await Promise.all([
      supabase
        .from('employees')
        .select('id, hire_date')
        .eq('org_id', orgId)
        .in('id', employeeIds),
      supabase
        .from('hr_settlements')
        .select('employee_id, service_end')
        .eq('org_id', orgId)
        .in('employee_id', employeeIds)
        .eq('status', 'approved'),
      supabase
        .from('employee_leaves')
        .select('employee_id, start_date, total_days, leave_type:leave_types(is_paid)')
        .eq('org_id', orgId)
        .in('employee_id', employeeIds)
        .eq('status', 'approved'),
      getHrPoliciesReadOnly(orgId),
    ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (settlementsResult.error) throw new Error(settlementsResult.error.message);
  if (leavesResult.error) throw new Error(leavesResult.error.message);

  const latestSettlement = latestSettlementsByEmployee(
    (settlementsResult.data ?? []) as LeaveSettlementRow[],
  );
  const indexedLeaves = leavesByEmployee(
    (leavesResult.data ?? []) as LeaveBalanceRow[],
  );

  const now = new Date();
  const balances = new Map<string, LeaveBalanceResult>();
  for (const employee of (employeesResult.data ?? []) as LeaveBalanceEmployee[]) {
    balances.set(employee.id, calculateEmployeeLeaveBalance(
      employee,
      latestSettlement.get(employee.id),
      indexedLeaves.get(employee.id) ?? [],
      policies,
      now,
    ));
  }

  return balances;
}

export async function getLeaveBalance(
  employeeId: string,
): Promise<LeaveBalanceResult> {
  const balance = (await listLeaveBalances([employeeId])).get(employeeId);
  if (!balance) throw new Error('Employee not found.');
  return balance;
}

// ─── Kept from original ────────────────────────────────────────────────────

type AttendanceSyncLeave = {
  employee_id: string;
  start_date: string;
  end_date: string;
  status: string;
  leave_type: { code?: string | null } | Array<{ code?: string | null }> | null;
};

function leaveAttendanceReason(leave: AttendanceSyncLeave): string {
  const leaveType = Array.isArray(leave.leave_type)
    ? leave.leave_type[0]
    : leave.leave_type;
  return (leaveType?.code ?? '').toUpperCase().includes('SICK') ? 'sick' : 'annual';
}

function inclusiveDateRange(startDate: string, endDate: string): string[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid leave dates.');
  }

  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export async function applyApprovedLeaveToAttendance(leaveId: string) {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data: leave, error } = await supabase
    .from('employee_leaves')
    .select(
      `
        id,
        employee_id,
        start_date,
        end_date,
        status,
        leave_type:leave_types(id, code, name)
      `,
    )
    .eq('id', leaveId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch leave for attendance sync:', error);
    throw error;
  }
  if (!leave) {
    throw new Error('Leave request not found.');
  }
  if (leave.status !== 'approved') {
    return;
  }

  const approvedLeave = leave as AttendanceSyncLeave;
  const reason = leaveAttendanceReason(approvedLeave);
  const dates = inclusiveDateRange(approvedLeave.start_date, approvedLeave.end_date);

  for (const date of dates) {
    await setDayStatusFallback(approvedLeave.employee_id, date, {
      status: 'leave',
      notes: `leave-request:${reason}`,
      source: 'leave-request',
    });
  }
}
