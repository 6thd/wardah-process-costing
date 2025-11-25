import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { setDayStatusFallback } from './attendance-service';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  leave_type_id: string;
  status: string;
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
    // Nothing to apply if not approved
    return;
  }

  // Handle leave_type which might be an object or array
  const leaveType = Array.isArray(leave.leave_type) ? leave.leave_type[0] : leave.leave_type;
  const leaveCode: string = (leaveType?.code ?? '') || '';
  const normalized = leaveCode.toUpperCase();
  let status = 'leave';
  let reason = 'annual';
  if (normalized.includes('SICK')) {
    reason = 'sick';
  }

  const start = new Date(leave.start_date);
  const end = new Date(leave.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid leave dates.');
  }

  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  for (const date of dates) {
    await setDayStatusFallback(leave.employee_id, date, {
      status,
      notes: `leave-request:${reason}`,
      source: 'leave-request',
    });
  }
}


