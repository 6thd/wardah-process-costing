import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { getHrPolicies, HrPolicies } from './policies-service';
import { listAttendanceForPeriod } from './attendance-service';
import { getPayrollLock, upsertPayrollLock } from './payroll-lock-service';
import {
  getPayrollAccountMappings,
  PayrollAccountMapping,
  PayrollAccountType,
} from './payroll-account-service';

export interface PayrollPreviewEmployee {
  employeeId: string;
  employeeCode?: string | null;
  name: string;
  department?: string | null;
  baseSalary: number;
  allowanceTotal: number;
  overtimeAmount: number;
  deductions: number;
  absenceDays: number;
  absenceAmount: number;
  gross: number;
  net: number;
  allowanceBreakdown?: Partial<Record<PayrollAccountType, number>>;
  deductionBreakdown?: Partial<Record<PayrollAccountType, number>>;
}

export interface PayrollPreviewResponse {
  year: number;
  month: number;
  locked: boolean;
  employees: PayrollPreviewEmployee[];
  totals: {
    gross: number;
    allowances: number;
    overtime: number;
    deductions: number;
    absence: number;
    net: number;
  };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const toMonthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`;

const getDaysInMonth = (year: number, month: number) => {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return DAYS_IN_MONTH[month - 1];
};

const getWeekendSet = (policies: HrPolicies) =>
  new Set((policies.weekend_days ?? ['friday']).map((day) => day.toLowerCase()));

const classifyAllowance = (code?: string | null): PayrollAccountType => {
  const normalized = (code || '').toUpperCase();
  if (normalized.includes('BASIC')) return 'basic_salary';
  if (normalized.includes('HRA') || normalized.includes('HOUSE') || normalized.includes('HSG'))
    return 'housing_allowance';
  if (normalized.includes('TRANS') || normalized.includes('TRANSPORT')) return 'transport_allowance';
  return 'other_allowance';
};

const classifyDeduction = (code?: string | null): PayrollAccountType => {
  const normalized = (code || '').toUpperCase();
  if (normalized.includes('LOAN') || normalized.includes('ADV')) return 'loans';
  return 'deductions';
};

const ensurePeriodBounds = (year: number, month: number) => {
  if (month < 1 || month > 12) throw new Error('Invalid month. Must be between 1 and 12.');
  if (year < 2000 || year > 2100) throw new Error('Invalid year.');
};

export async function calculatePayrollPreview(
  year: number,
  month: number,
): Promise<PayrollPreviewResponse> {
  ensurePeriodBounds(year, month);

  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const [policies, payrollLock, employeesRes, salaryStructuresRes] = await Promise.all([
    getHrPolicies(),
    getPayrollLock(year, month),
    supabase
      .from('employees')
      .select('id, employee_id, first_name, last_name, department, salary, status')
      .eq('org_id', orgId)
      .eq('status', 'active'),
    supabase
      .from('employee_salary_structures')
      .select(
        `
        id,
        employee_id,
        value,
        component:salary_components(
          id,
          code,
          name,
          component_type
        )
      `,
      )
      .eq('org_id', orgId)
      .is('is_active', true),
  ]);

  if (employeesRes.error) throw employeesRes.error;
  if (salaryStructuresRes.error) throw salaryStructuresRes.error;

  const employees = employeesRes.data ?? [];
  const salaryStructures = salaryStructuresRes.data ?? [];

  const employeeIds = employees.map((emp) => emp.id);
  const attendance = await listAttendanceForPeriod(employeeIds, year, month);
  const attendanceMap = new Map(attendance.map((record) => [record.employee_id, record]));

  const structuresByEmployee = salaryStructures.reduce<Record<string, typeof salaryStructures>>(
    (acc, structure) => {
      const list = acc[structure.employee_id] ?? [];
      list.push(structure);
      acc[structure.employee_id] = list;
      return acc;
    },
    {},
  );

  const weekendSet = getWeekendSet(policies);
  const workingDays = getWorkingDays(year, month, weekendSet);

  const previewEmployees: PayrollPreviewEmployee[] = [];
  let totalsGross = 0;
  let totalsAllowances = 0;
  let totalsOvertime = 0;
  let totalsDeductions = 0;
  let totalsAbsence = 0;

  for (const employee of employees) {
    const components = (structuresByEmployee[employee.id] ?? []) as Array<{
      value: number;
      component: { code?: string | null; component_type?: string | null } | null;
    }>;
    const { base, allowances, deductions, allowanceBreakdown, deductionBreakdown } =
      extractCompensationComponents(components);

    const baseSalary = base ?? Number(employee.salary ?? 0);
    const allowanceTotal = sumValues(allowances);
    const deductionTotal = sumValues(deductions);

    const attendanceRecord = attendanceMap.get(employee.id);
    const { absenceDays, absenceAmount, overtimeAmount } = calculateAttendanceAdjustments(
      attendanceRecord?.days ?? {},
      baseSalary,
      policies,
      workingDays,
    );

    const gross = baseSalary + allowanceTotal + overtimeAmount;
    const net = gross - deductionTotal - absenceAmount;

    previewEmployees.push({
      employeeId: employee.id,
      employeeCode: employee.employee_id,
      name: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || 'موظف',
      department: employee.department,
      baseSalary,
      allowanceTotal,
      overtimeAmount,
      deductions: deductionTotal,
      absenceDays,
      absenceAmount,
      gross,
      net,
      allowanceBreakdown: addToBreakdown(allowanceBreakdown, 'other_allowance', overtimeAmount),
      deductionBreakdown: addToBreakdown(deductionBreakdown, 'deductions', absenceAmount),
    });

    totalsGross += gross;
    totalsAllowances += allowanceTotal;
    totalsOvertime += overtimeAmount;
    totalsDeductions += deductionTotal;
    totalsAbsence += absenceAmount;
  }

  const totalsNet = totalsGross - totalsDeductions - totalsAbsence;

  return {
    year,
    month,
    locked: payrollLock?.status === 'locked',
    employees: previewEmployees,
    totals: {
      gross: totalsGross,
      allowances: totalsAllowances,
      overtime: totalsOvertime,
      deductions: totalsDeductions,
      absence: totalsAbsence,
      net: totalsNet,
    },
  };
}

interface AttendanceAdjustments {
  absenceDays: number;
  absenceAmount: number;
  overtimeAmount: number;
}

const calculateAttendanceAdjustments = (
  days: Record<string, { status?: string; check_in?: string; check_in_time?: string; check_out?: string; check_out_time?: string }> | undefined,
  baseSalary: number,
  policies: HrPolicies,
  workingDays: number,
): AttendanceAdjustments => {
  if (!days) {
    return { absenceDays: 0, absenceAmount: 0, overtimeAmount: 0 };
  }

  let absenceDays = 0;
  let overtimeHours = 0;
  const expectedHours = Number(policies.employee_daily_hours ?? 8);
  const graceMinutes = Number(policies.overtime_grace_minutes ?? 0);

  for (const day of Object.values(days)) {
    const status = String(day.status || '').toLowerCase();
    if (status === 'absent') {
      absenceDays += 1;
      continue;
    }

    if (status === 'present') {
      const checkIn = day.check_in || day.check_in_time;
      const checkOut = day.check_out || day.check_out_time;
      if (checkIn && checkOut) {
        const started = new Date(checkIn).getTime();
        const ended = new Date(checkOut).getTime();
        if (!Number.isNaN(started) && !Number.isNaN(ended) && ended > started) {
          const hours = (ended - started) / (1000 * 60 * 60);
          const overtime = hours - expectedHours;
          if (overtime > graceMinutes / 60) {
            overtimeHours += overtime;
          }
        }
      }
    }
  }

  const dailyRate = workingDays > 0 ? baseSalary / workingDays : baseSalary / 30;
  const absenceAmount = absenceDays * dailyRate;
  const hourlyRate = expectedHours > 0 ? baseSalary / (workingDays * expectedHours || expectedHours) : 0;
  const overtimeAmount = overtimeHours * hourlyRate * Number(policies.overtime_multiplier ?? 1.5);

  return { absenceDays, absenceAmount, overtimeAmount };
};

const getWorkingDays = (year: number, month: number, weekendSet: Set<string>) => {
  const daysInMonth = getDaysInMonth(year, month);
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    if (!weekendSet.has(dayName)) {
      workingDays += 1;
    }
  }
  return workingDays;
};

const extractCompensationComponents = (
  components: Array<{
    value: number;
    component: { code?: string | null; component_type?: string | null } | null;
  }>,
): {
  base: number | null;
  allowances: typeof components;
  deductions: typeof components;
  allowanceBreakdown: Partial<Record<PayrollAccountType, number>>;
  deductionBreakdown: Partial<Record<PayrollAccountType, number>>;
} => {
  const earnings: typeof components = [];
  const deductions: typeof components = [];
  let base: number | null = null;
  const allowanceBreakdown: Partial<Record<PayrollAccountType, number>> = {};
  const deductionBreakdown: Partial<Record<PayrollAccountType, number>> = {};

  for (const component of components) {
    const compType = component.component?.component_type?.toLowerCase();
    const code = component.component?.code?.toUpperCase() ?? '';
    if (compType === 'deduction') {
      deductions.push(component);
       const bucket = classifyDeduction(code);
       deductionBreakdown[bucket] = (deductionBreakdown[bucket] ?? 0) + Number(component.value || 0);
      continue;
    }

    if (compType === 'earning' || compType === 'benefit') {
      if (!base && (code.includes('BASIC') || code === 'BASIC')) {
        base = Number(component.value || 0);
      } else {
        earnings.push(component);
        const bucket = classifyAllowance(code);
        allowanceBreakdown[bucket] = (allowanceBreakdown[bucket] ?? 0) + Number(component.value || 0);
      }
    }
  }

  return { base, allowances: earnings, deductions, allowanceBreakdown, deductionBreakdown };
};

const sumValues = (items: Array<{ value: number }>) =>
  items.reduce((sum, item) => sum + Number(item.value || 0), 0);

const addToBreakdown = (
  breakdown: Partial<Record<PayrollAccountType, number>>,
  bucket: PayrollAccountType,
  amount: number,
) => {
  if (!amount) return breakdown;
  return {
    ...breakdown,
    [bucket]: (breakdown[bucket] ?? 0) + amount,
  };
};

interface PeriodResult {
  id: string;
}

const ensurePayrollPeriod = async (
  orgId: string,
  year: number,
  month: number,
): Promise<PeriodResult> => {
  const periodCode = toMonthKey(year, month);
  const { data, error } = await supabase
    .from('payroll_periods')
    .select('id')
    .eq('org_id', orgId)
    .eq('period_code', periodCode)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) return data;

  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString().split('T')[0];
  const endDate = new Date(Date.UTC(year, month - 1, getDaysInMonth(year, month))).toISOString().split('T')[0];

  const { data: inserted, error: insertError } = await supabase
    .from('payroll_periods')
    .insert({
      org_id: orgId,
      period_code: periodCode,
      period_name: periodCode,
      period_type: 'monthly',
      start_date: startDate,
      end_date: endDate,
      status: 'open',
    })
    .select('id')
    .single();

  if (insertError) throw insertError;
  return inserted;
};

const ensurePayrollRun = async (
  orgId: string,
  periodId: string,
  totals: { gross: number; deductions: number; net: number },
) => {
  const { data, error } = await supabase
    .from('payroll_runs')
    .insert({
      org_id: orgId,
      period_id: periodId,
      run_date: new Date().toISOString().split('T')[0],
      status: 'calculated',
      total_gross: totals.gross,
      total_deductions: totals.deductions,
      total_net: totals.net,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
};

export async function processPayrollRun(year: number, month: number) {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const preview = await calculatePayrollPreview(year, month);
  if (!preview.employees.length) throw new Error('لا توجد بيانات رواتب لهذا الشهر.');
  if (preview.locked) throw new Error('تم إقفال هذا الشهر مسبقاً.');

  const [lock, accountMappings] = await Promise.all([
    upsertPayrollLock(year, month, 'generated'),
    getPayrollAccountMappings(),
  ]);

  const mappingByType = new Map<PayrollAccountType, PayrollAccountMapping>();
  for (const mapping of accountMappings) {
    mappingByType.set(mapping.account_type, mapping);
  }

  const classificationTotals = classifyTotals(preview, mappingByType);

  const requiredAccounts: PayrollAccountType[] = ['basic_salary', 'payable'];
  for (const type of requiredAccounts) {
    if ((classificationTotals[type] ?? 0) > 0 && !mappingByType.has(type)) {
      throw new Error(`الرجاء ضبط حساب ${type} قبل إقفال الرواتب.`);
    }
  }

  const period = await ensurePayrollPeriod(orgId, year, month);
  const run = await ensurePayrollRun(orgId, period.id, {
    gross: preview.totals.gross,
    deductions: preview.totals.deductions + preview.totals.absence,
    net: preview.totals.net,
  });

  const journalEntryId = await createPayrollJournalEntry({
    orgId,
    year,
    month,
    totals: classificationTotals,
    mappingByType,
  });

  await Promise.all([
    supabase.from('payroll_runs').update({ status: 'paid' }).eq('id', run.id),
    upsertPayrollLock(year, month, 'locked', { journal_entry_id: journalEntryId }),
  ]);

  return { journal_entry_id: journalEntryId, payroll_run_id: run.id, lock_id: lock.id };
}

const classifyTotals = (
  preview: PayrollPreviewResponse,
  mappingByType: Map<PayrollAccountType, PayrollAccountMapping>,
) => {
  const totals: Record<PayrollAccountType, number> = {
    basic_salary: 0,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowance: 0,
    deductions: 0,
    loans: 0,
    payable: 0,
    net_payable: 0,
  };

  for (const employee of preview.employees) {
    totals.basic_salary += employee.baseSalary;
    for (const [type, value] of Object.entries(employee.allowanceBreakdown ?? {})) {
      totals[type as PayrollAccountType] =
        (totals[type as PayrollAccountType] ?? 0) + Number(value || 0);
    }
    for (const [type, value] of Object.entries(employee.deductionBreakdown ?? {})) {
      totals[type as PayrollAccountType] =
        (totals[type as PayrollAccountType] ?? 0) + Number(value || 0);
    }
  }

  totals.payable = preview.totals.net;

  // Ensure only mapped account types are returned
  for (const [type, mapping] of mappingByType.entries()) {
    if (!(type in totals)) {
      totals[type] = 0;
    } else if (!mapping && totals[type] > 0) {
      throw new Error(`Missing GL mapping for ${type}`);
    }
  }

  return totals;
};

const createPayrollJournalEntry = async ({
  orgId,
  year,
  month,
  totals,
  mappingByType,
}: {
  orgId: string;
  year: number;
  month: number;
  totals: Record<string, number>;
  mappingByType: Map<PayrollAccountType, PayrollAccountMapping>;
}) => {
  const entryDate = new Date(Date.UTC(year, month - 1, getDaysInMonth(year, month)))
    .toISOString()
    .split('T')[0];
  const description = `قيد رواتب ${toMonthKey(year, month)}`;

  const debitLines: { account_type: PayrollAccountType; amount: number }[] = [
    'basic_salary',
    'housing_allowance',
    'transport_allowance',
    'other_allowance',
  ].map((type) => ({ account_type: type as PayrollAccountType, amount: totals[type] || 0 }));

  const creditLines: { account_type: PayrollAccountType; amount: number }[] = [
    { account_type: 'deductions', amount: totals.deductions || 0 },
    { account_type: 'loans', amount: totals.loans || 0 },
    { account_type: 'payable', amount: totals.payable || 0 },
  ];

  const totalDebit = debitLines.reduce((sum, line) => sum + line.amount, 0);
  const totalCredit = creditLines.reduce((sum, line) => sum + line.amount, 0);

  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    throw new Error('قيود الرواتب غير متوازنة، يرجى مراجعة السياسات والمبالغ.');
  }

  const { data: entry, error: entryError } = await supabase
    .from('gl_entries')
    .insert({
      org_id: orgId,
      entry_date: entryDate,
      description,
      description_ar: description,
      reference_type: 'PAYROLL',
      reference_number: toMonthKey(year, month),
      total_debit: totalDebit,
      total_credit: totalCredit,
      status: 'posted',
    })
    .select('id')
    .single();

  if (entryError) throw entryError;

  let lineNumber = 1;
  const linesPayload: any[] = [];

  const appendLines = (lines: { account_type: PayrollAccountType; amount: number }[], side: 'debit' | 'credit') => {
    for (const line of lines) {
      if (!line.amount) continue;
      const mapping = mappingByType.get(line.account_type);
      if (!mapping) continue;
      linesPayload.push({
        org_id: orgId,
        entry_id: entry.id,
        line_number: lineNumber++,
        account_id: mapping.gl_account_id,
        debit: side === 'debit' ? line.amount : 0,
        credit: side === 'credit' ? line.amount : 0,
      });
    }
  };

  appendLines(debitLines, 'debit');
  appendLines(creditLines, 'credit');

  if (linesPayload.length === 0) {
    throw new Error('لم يتم العثور على حسابات صالحة لإنشاء القيد.');
  }

  const { error: linesError } = await supabase.from('gl_entry_lines').insert(linesPayload);
  if (linesError) throw linesError;

  return entry.id as string;
};

