/**
 * محرّك الرواتب (P12-C) — حساب كامل بسياسات قابلة للضبط، يصحّح ما أخطأ فيه
 * النظام المرجعي «حاسبني»:
 *   • GOSI محسوب فعلاً: وعاء = أساسي+سكن بسقف gosi_base_cap، حصة موظف تُخصم
 *     وحصة صاحب عمل مصروف، حسب is_saudi وسياسة gosi_applies_to.
 *   • الإجازة المدفوعة لا تُخصم كغياب (كانت تُخصم في حاسبني — مخالف للنظام).
 *   • مكوّنات percentage تُقيَّم من أساسها (كانت تُعامل كمبالغ ثابتة صامتة)،
 *     وformula تُرفض بوضوح (غير مدعومة).
 *   • المعدل اليومي ووعاء الإضافي بسياسة (working_days/thirty، basic/basic_housing).
 *   • تعديلات hr_payroll_adjustments (سلف/جزاءات/عمولات/أقساط) تدخل الحساب.
 * الاعتماد النهائي عبر rpc_post_payroll_run الذرّي (Migration 100) — القيد
 * حصراً من القناة القانونية rpc_create_journal_entry. لا ترحيل client-side.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { getHrPolicies, HrPolicies } from './policies-service';
import { listAttendanceForPeriod } from './attendance-service';
import { getPayrollLock } from './payroll-lock-service';
import { PayrollAccountType } from './payroll-account-service';
import { listAdjustmentsForMonth, PayrollAdjustment } from './adjustments-service';

// ===== أنواع =====

/**
 * تصنيف السطر إلى bucket قيد محاسبي — يُرسل مع كل سطر إلى rpc_post_payroll_run
 * (Migration 101) الذي يشتق مجاميع الـbuckets من السطور ويطابقها مع totals،
 * فلا يمكن إعادة توزيع القيد دون أن يظهر ذلك في تفاصيل القسائم.
 * ملاحظة: gosi_employee ليس bucket قيد مستقلاً — حصة الموظف تدخل ضمن
 * gosi_payable الدائن (مع حصة صاحب العمل gosi_employer_expense التي بلا سطر).
 */
export type PayrollLineBucket =
  | 'basic_salary'
  | 'housing_allowance'
  | 'transport_allowance'
  | 'other_allowance'
  | 'overtime'
  | 'deductions'
  | 'loans'
  | 'absence_recovery'
  | 'gosi_employee';

export interface PayrollLine {
  employee_id: string;
  component_code: string;
  component_label: string;
  amount: number;
  is_deduction: boolean;
  bucket: PayrollLineBucket;
}

export interface PayrollPreviewEmployee {
  employeeId: string;
  employeeCode?: string | null;
  name: string;
  department?: string | null;
  baseSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  overtimeAmount: number;
  gosiEmployee: number;
  gosiEmployer: number;
  componentDeductions: number;
  loanDeductions: number;
  adjustmentAllowances: number;
  adjustmentDeductions: number;
  absenceDays: number;
  unpaidLeaveDays: number;
  absenceAmount: number;
  gross: number;
  net: number;
  lines: PayrollLine[];
  /** مجموع البدلات (توافق عرض) */
  allowanceTotal: number;
  /** مجموع الاستقطاعات عدا الغياب: GOSI موظف + مكوّنات + قروض + تعديلات (توافق عرض) */
  deductions: number;
}

export type PayrollBuckets = Partial<Record<PayrollAccountType, number>>;

export interface PayrollPreviewResponse {
  year: number;
  month: number;
  locked: boolean;
  employees: PayrollPreviewEmployee[];
  buckets: PayrollBuckets; // جاهزة لحمولة rpc_post_payroll_run
  totals: {
    gross: number;
    allowances: number;
    overtime: number;
    gosiEmployee: number;
    gosiEmployer: number;
    deductions: number;
    absence: number;
    net: number;
  };
}

interface AttendanceDay {
  status?: string;
  paid?: boolean;
  check_in?: string;
  check_in_time?: string;
  check_out?: string;
  check_out_time?: string;
  in?: string;
  out?: string;
}

interface StructureRow {
  employee_id: string;
  value: number;
  component: {
    code?: string | null;
    name?: string | null;
    name_ar?: string | null;
    component_type?: string | null;
    calculation_type?: string | null;
    percentage_base?: string | null;
  } | null;
}

// ===== دوال صافية (مُختبرة وحدوياً) =====

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const getDaysInMonth = (year: number, month: number) => {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return DAYS_IN_MONTH[month - 1];
};

export const getWorkingDays = (year: number, month: number, weekendSet: Set<string>) => {
  const daysInMonth = getDaysInMonth(year, month);
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    if (!weekendSet.has(dayName)) workingDays += 1;
  }
  return workingDays;
};

/**
 * تقييم مبلغ مكوّن راتب حسب calculation_type:
 * fixed ⇒ القيمة كما هي؛ percentage ⇒ نسبة من الأساس (basic افتراضاً)؛
 * formula ⇒ رفض واضح (كانت تُعامل كمبلغ ثابت صامت — علّة).
 */
export function evaluateComponentAmount(
  calculationType: string | null | undefined,
  structureValue: number,
  basicBase: number,
  _percentageBase?: string | null,
): number {
  const type = (calculationType || 'fixed').toLowerCase();
  if (type === 'fixed') return structureValue;
  if (type === 'percentage') {
    return (structureValue / 100) * basicBase;
  }
  throw new Error(`مكوّن راتب بنوع حساب غير مدعوم: ${calculationType} — عدّله إلى fixed أو percentage`);
}

export interface GosiResult {
  employee: number;
  employer: number;
  base: number;
}

/**
 * GOSI صحيح (عكس حاسبني): الوعاء = أساسي + سكن بسقف gosi_base_cap؛
 * saudi_only ⇒ غير السعودي بلا حصص (مبسّط — حصة الأخطار المهنية للوافد تُضاف
 * لاحقاً عند الحاجة)؛ all ⇒ الجميع؛ none ⇒ معطَّل.
 */
export function computeGosi(
  basic: number,
  housing: number,
  policies: Pick<HrPolicies, 'gosi_employee_pct' | 'gosi_employer_pct' | 'gosi_base_cap' | 'gosi_applies_to'>,
  isSaudi: boolean | null | undefined,
): GosiResult {
  const applies =
    policies.gosi_applies_to === 'all' ||
    (policies.gosi_applies_to === 'saudi_only' && isSaudi === true);
  if (!applies) return { employee: 0, employer: 0, base: 0 };

  const base = Math.min(basic + housing, Number(policies.gosi_base_cap ?? 45000));
  return {
    employee: round2(base * (Number(policies.gosi_employee_pct) / 100)),
    employer: round2(base * (Number(policies.gosi_employer_pct) / 100)),
    base,
  };
}

export interface AttendanceAdjustments {
  absenceDays: number;
  unpaidLeaveDays: number;
  overtimeHours: number;
}

/**
 * تحليل حضور الشهر: الغياب يُخصم، الإجازة غير المدفوعة تُخصم،
 * **الإجازة المدفوعة لا تُخصم** (paid !== false)، والإضافي من in/out.
 */
export function analyzeAttendance(
  days: Record<string, AttendanceDay> | undefined,
  expectedHours: number,
  graceMinutes: number,
): AttendanceAdjustments {
  const result: AttendanceAdjustments = { absenceDays: 0, unpaidLeaveDays: 0, overtimeHours: 0 };
  if (!days) return result;

  for (const day of Object.values(days)) {
    const status = String(day.status || '').toLowerCase();
    if (status === 'absent') {
      result.absenceDays += 1;
      continue;
    }
    if (status === 'unpaid_leave' || (status === 'leave' && day.paid === false)) {
      result.unpaidLeaveDays += 1;
      continue;
    }
    if (status === 'present') {
      const checkIn = day.check_in || day.check_in_time || day.in;
      const checkOut = day.check_out || day.check_out_time || day.out;
      if (checkIn && checkOut) {
        const started = new Date(checkIn).getTime();
        const ended = new Date(checkOut).getTime();
        if (!Number.isNaN(started) && !Number.isNaN(ended) && ended > started) {
          const hours = (ended - started) / (1000 * 60 * 60);
          const overtime = hours - expectedHours;
          if (overtime > graceMinutes / 60) result.overtimeHours += overtime;
        }
      }
    }
  }
  return result;
}

/** المعدل اليومي بسياسة: أيام العمل الفعلية أو /30 (وعاء الخصم = الأساسي). */
export function dailyRateOf(
  basic: number,
  workingDays: number,
  basis: HrPolicies['daily_rate_basis'],
): number {
  if (basis === 'thirty') return basic / 30;
  return workingDays > 0 ? basic / workingDays : basic / 30;
}

/** أجرة ساعة الإضافي بسياسة الوعاء (أساسي أو أساسي+سكن). */
export function overtimeHourlyRate(
  basic: number,
  housing: number,
  workingDays: number,
  dailyHours: number,
  base: HrPolicies['overtime_base'],
): number {
  const wage = base === 'basic_housing' ? basic + housing : basic;
  const hours = workingDays * dailyHours;
  return hours > 0 ? wage / hours : 0;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

const classifyAllowanceBucket = (
  code: string,
): Extract<PayrollLineBucket, 'housing_allowance' | 'transport_allowance' | 'other_allowance'> => {
  const normalized = code.toUpperCase();
  if (normalized.includes('HRA') || normalized.includes('HOUSE') || normalized.includes('HSG'))
    return 'housing_allowance';
  if (normalized.includes('TRANS')) return 'transport_allowance';
  return 'other_allowance';
};

const isGosiComponent = (code: string) => code.toUpperCase().includes('GOSI');
const isLoanComponent = (code: string) => {
  const normalized = code.toUpperCase();
  return normalized.includes('LOAN') || normalized.includes('ADV');
};

// ===== المعاينة =====

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

  const [policies, payrollLock, adjustments, employeesRes, structuresRes] = await Promise.all([
    getHrPolicies(),
    getPayrollLock(year, month),
    listAdjustmentsForMonth(year, month),
    supabase
      .from('employees')
      .select('id, employee_id, first_name, last_name, department, salary, status, is_saudi')
      .eq('org_id', orgId)
      .eq('status', 'active'),
    supabase
      .from('employee_salary_structures')
      .select(`
        id, employee_id, value,
        component:salary_components(
          id, code, name, name_ar, component_type, calculation_type, percentage_base
        )
      `)
      .eq('org_id', orgId)
      .is('is_active', true),
  ]);

  if (employeesRes.error) throw employeesRes.error;
  if (structuresRes.error) throw structuresRes.error;

  const employees = employeesRes.data ?? [];
  const structures = (structuresRes.data ?? []) as unknown as StructureRow[];

  const employeeIds = employees.map((emp) => emp.id);
  const attendance = await listAttendanceForPeriod(employeeIds, year, month);
  const attendanceMap = new Map(attendance.map((record) => [record.employee_id, record]));

  const structuresByEmployee = new Map<string, StructureRow[]>();
  for (const s of structures) {
    const list = structuresByEmployee.get(s.employee_id) ?? [];
    list.push(s);
    structuresByEmployee.set(s.employee_id, list);
  }

  const adjustmentsByEmployee = new Map<string, PayrollAdjustment[]>();
  for (const adj of adjustments) {
    if (!adj.employee_id) continue;
    const list = adjustmentsByEmployee.get(adj.employee_id) ?? [];
    list.push(adj);
    adjustmentsByEmployee.set(adj.employee_id, list);
  }

  const weekendSet = new Set((policies.weekend_days ?? ['friday']).map((d) => d.toLowerCase()));
  const workingDays = getWorkingDays(year, month, weekendSet);
  const expectedHours = Number(policies.employee_daily_hours ?? 8);

  const previewEmployees: PayrollPreviewEmployee[] = [];
  const buckets: PayrollBuckets = {};
  const addBucket = (type: PayrollAccountType, amount: number) => {
    if (!amount) return;
    buckets[type] = round2((buckets[type] ?? 0) + amount);
  };

  for (const employee of employees) {
    const comps = structuresByEmployee.get(employee.id) ?? [];
    const lines: PayrollLine[] = [];

    // 1) الأساسي أولاً (يلزم لتقييم النسب)
    let baseSalary = 0;
    for (const c of comps) {
      const code = c.component?.code?.toUpperCase() ?? '';
      const compType = c.component?.component_type?.toLowerCase();
      if ((compType === 'earning' || compType === 'benefit') && code.includes('BASIC')) {
        baseSalary += evaluateComponentAmount(
          c.component?.calculation_type, Number(c.value || 0), 0, c.component?.percentage_base);
      }
    }
    if (baseSalary === 0) baseSalary = Number(employee.salary ?? 0);

    // 2) البدلات والاستقطاعات (النسب من الأساسي)
    let housingAllowance = 0;
    let transportAllowance = 0;
    let otherAllowance = 0;
    let componentDeductions = 0;
    let loanDeductions = 0;

    for (const c of comps) {
      const code = c.component?.code?.toUpperCase() ?? '';
      const label = c.component?.name_ar || c.component?.name || code;
      const compType = c.component?.component_type?.toLowerCase();
      if ((compType === 'earning' || compType === 'benefit') && !code.includes('BASIC')) {
        const amount = round2(evaluateComponentAmount(
          c.component?.calculation_type, Number(c.value || 0), baseSalary, c.component?.percentage_base));
        if (!amount) continue;
        const bucket = classifyAllowanceBucket(code);
        if (bucket === 'housing_allowance') housingAllowance += amount;
        else if (bucket === 'transport_allowance') transportAllowance += amount;
        else otherAllowance += amount;
        lines.push({ employee_id: employee.id, component_code: code, component_label: label, amount, is_deduction: false, bucket });
      } else if (compType === 'deduction') {
        // GOSI يُحسب من السياسات لا من المكوّنات (منع الازدواج)
        if (isGosiComponent(code)) continue;
        const amount = round2(evaluateComponentAmount(
          c.component?.calculation_type, Number(c.value || 0), baseSalary, c.component?.percentage_base));
        if (!amount) continue;
        const isLoan = isLoanComponent(code);
        if (isLoan) loanDeductions += amount;
        else componentDeductions += amount;
        lines.push({ employee_id: employee.id, component_code: code, component_label: label, amount, is_deduction: true, bucket: isLoan ? 'loans' : 'deductions' });
      }
    }

    if (baseSalary > 0) {
      lines.unshift({ employee_id: employee.id, component_code: 'BASIC', component_label: 'الراتب الأساسي', amount: round2(baseSalary), is_deduction: false, bucket: 'basic_salary' });
    }

    // 3) الحضور: غياب/إجازة غير مدفوعة/إضافي
    const attendanceRecord = attendanceMap.get(employee.id);
    const att = analyzeAttendance(
      (attendanceRecord?.days ?? {}) as Record<string, AttendanceDay>,
      expectedHours,
      Number(policies.overtime_grace_minutes ?? 0),
    );
    const dailyRate = dailyRateOf(baseSalary, workingDays, policies.daily_rate_basis);
    const deductibleDays = att.absenceDays + att.unpaidLeaveDays;
    const absenceAmount = round2(deductibleDays * dailyRate);
    const hourlyRate = overtimeHourlyRate(
      baseSalary, housingAllowance, workingDays, expectedHours, policies.overtime_base);
    // إضافي الحضور منفصل عن تعديلات الإضافي: سطر OT يحمل مبلغ الحضور فقط،
    // وكل تعديل إضافي سطر ADJ_OVERTIME مستقل — كان المبلغ يُدمج في overtimeAmount
    // ويُدفع سطراً مستقلاً معاً فيتضاعف في القسيمة ويكسر عقد Σسطور=gross (علّة E1)
    const attendanceOvertime = round2(att.overtimeHours * hourlyRate * Number(policies.overtime_multiplier ?? 1.5));
    let overtimeAmount = attendanceOvertime;

    // 4) التعديلات الشهرية
    let adjustmentAllowances = 0;
    let adjustmentDeductions = 0;
    for (const adj of adjustmentsByEmployee.get(employee.id) ?? []) {
      const amount = round2(Number(adj.amount || 0));
      if (!amount) continue;
      if (amount < 0) {
        // rpc_post_payroll_run (Migration 101) يرفض السطور غير الموجبة —
        // التعديل السالب يُسجَّل بنوعه المعاكس (allowance سالب ⇒ deduction)
        throw new Error(
          `تعديل رواتب بمبلغ سالب (${amount}) للموظف ${employee.id} — سجّله بالنوع المعاكس بمبلغ موجب`);
      }
      const label = adj.description || adj.adjustment_type;
      if (adj.adjustment_type === 'allowance') {
        adjustmentAllowances += amount;
        lines.push({ employee_id: employee.id, component_code: 'ADJ_ALLOWANCE', component_label: label, amount, is_deduction: false, bucket: 'other_allowance' });
      } else if (adj.adjustment_type === 'overtime') {
        overtimeAmount = round2(overtimeAmount + amount);
        lines.push({ employee_id: employee.id, component_code: 'ADJ_OVERTIME', component_label: label, amount, is_deduction: false, bucket: 'overtime' });
      } else if (adj.adjustment_type === 'loan') {
        loanDeductions += amount;
        lines.push({ employee_id: employee.id, component_code: 'ADJ_LOAN', component_label: label, amount, is_deduction: true, bucket: 'loans' });
      } else {
        adjustmentDeductions += amount;
        lines.push({ employee_id: employee.id, component_code: 'ADJ_DEDUCTION', component_label: label, amount, is_deduction: true, bucket: 'deductions' });
      }
    }

    // 5) GOSI من السياسات
    const gosi = computeGosi(baseSalary, housingAllowance, policies, employee.is_saudi);
    if (gosi.employee > 0) {
      lines.push({ employee_id: employee.id, component_code: 'GOSI_EMP', component_label: 'التأمينات — حصة الموظف', amount: gosi.employee, is_deduction: true, bucket: 'gosi_employee' });
    }
    if (attendanceOvertime > 0) {
      lines.push({ employee_id: employee.id, component_code: 'OT', component_label: 'عمل إضافي', amount: attendanceOvertime, is_deduction: false, bucket: 'overtime' });
    }
    if (absenceAmount > 0) {
      lines.push({ employee_id: employee.id, component_code: 'ABSENCE', component_label: 'خصم غياب/إجازة غير مدفوعة', amount: absenceAmount, is_deduction: true, bucket: 'absence_recovery' });
    }

    const allowanceTotal = round2(housingAllowance + transportAllowance + otherAllowance + adjustmentAllowances);
    const gross = round2(baseSalary + allowanceTotal + overtimeAmount);
    const totalDeductions = round2(
      gosi.employee + componentDeductions + loanDeductions + adjustmentDeductions + absenceAmount);
    const net = round2(gross - totalDeductions);

    previewEmployees.push({
      employeeId: employee.id,
      employeeCode: employee.employee_id,
      name: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || 'موظف',
      department: employee.department,
      baseSalary: round2(baseSalary),
      housingAllowance: round2(housingAllowance),
      transportAllowance: round2(transportAllowance),
      otherAllowance: round2(otherAllowance + adjustmentAllowances),
      overtimeAmount,
      gosiEmployee: gosi.employee,
      gosiEmployer: gosi.employer,
      componentDeductions: round2(componentDeductions + adjustmentDeductions),
      loanDeductions: round2(loanDeductions),
      adjustmentAllowances: round2(adjustmentAllowances),
      adjustmentDeductions: round2(adjustmentDeductions),
      absenceDays: att.absenceDays,
      unpaidLeaveDays: att.unpaidLeaveDays,
      absenceAmount,
      gross,
      net,
      lines,
      allowanceTotal,
      deductions: round2(gosi.employee + componentDeductions + loanDeductions + adjustmentDeductions),
    });

    addBucket('basic_salary', baseSalary);
    addBucket('housing_allowance', housingAllowance);
    addBucket('transport_allowance', transportAllowance);
    addBucket('other_allowance', otherAllowance + adjustmentAllowances);
    addBucket('overtime', overtimeAmount);
    addBucket('gosi_employer_expense', gosi.employer);
    addBucket('gosi_payable', gosi.employee + gosi.employer);
    addBucket('deductions', componentDeductions + adjustmentDeductions);
    addBucket('loans', loanDeductions);
    addBucket('absence_recovery', absenceAmount);
    addBucket('payable', net);
  }

  const totals = previewEmployees.reduce(
    (acc, emp) => ({
      gross: round2(acc.gross + emp.gross),
      allowances: round2(acc.allowances + emp.housingAllowance + emp.transportAllowance + emp.otherAllowance),
      overtime: round2(acc.overtime + emp.overtimeAmount),
      gosiEmployee: round2(acc.gosiEmployee + emp.gosiEmployee),
      gosiEmployer: round2(acc.gosiEmployer + emp.gosiEmployer),
      deductions: round2(acc.deductions + emp.componentDeductions + emp.loanDeductions),
      absence: round2(acc.absence + emp.absenceAmount),
      net: round2(acc.net + emp.net),
    }),
    { gross: 0, allowances: 0, overtime: 0, gosiEmployee: 0, gosiEmployer: 0, deductions: 0, absence: 0, net: 0 },
  );

  return {
    year,
    month,
    locked: payrollLock?.status === 'locked',
    employees: previewEmployees,
    buckets,
    totals,
  };
}

// ===== الاعتماد (عبر الـ RPC الذرّي حصراً) =====

export interface ProcessPayrollResult {
  payroll_run_id: string;
  journal_entry_id: string;
  entry_number?: string;
  replayed: boolean;
}

/** ترجمة أخطاء rpc_post_payroll_run/rpc_post_settlement (Migrations 100/101) لرسائل واضحة. */
const RPC_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHORIZED_PAYROLL_POST: 'اعتماد مسير الرواتب يتطلب صلاحية مدير المؤسسة (admin/owner).',
  NOT_AUTHORIZED_SETTLEMENT_POST: 'اعتماد التسوية يتطلب صلاحية مدير المؤسسة (admin/owner).',
  TOTALS_MISMATCH: 'إجماليات المسير لا تطابق مجموع السطور — أعد حساب المعاينة قبل الاعتماد.',
  BUCKETS_MISMATCH: 'توزيع القيد المحاسبي لا يطابق تفاصيل السطور — أعد حساب المعاينة قبل الاعتماد.',
  EMPLOYEE_ORG_MISMATCH: 'أحد الموظفين في المسير لا يتبع هذه المؤسسة.',
  INVALID_LINE: 'سطر مسير غير صالح (مبلغ غير موجب أو حقول ناقصة).',
  PAYLOAD_VERSION_UNSUPPORTED: 'إصدار الواجهة أقدم من الخادم — حدّث الصفحة ثم أعد المحاولة.',
  IDEMPOTENCY_KEY_REUSED: 'مفتاح الاعتماد مستخدم سابقاً بحمولة مختلفة — أنشئ اعتماداً جديداً.',
  PAYROLL_MONTH_LOCKED: 'هذا الشهر مقفل رواتبياً.',
};

export const translateRpcError = (message: string): string => {
  for (const [code, friendly] of Object.entries(RPC_ERROR_MESSAGES)) {
    if (message.includes(code)) return friendly;
  }
  return message;
};

export async function processPayrollRun(
  year: number,
  month: number,
  idempotencyKey?: string,
): Promise<ProcessPayrollResult> {
  const preview = await calculatePayrollPreview(year, month);
  if (!preview.employees.length) throw new Error('لا توجد بيانات رواتب لهذا الشهر.');
  if (preview.locked) throw new Error('تم إقفال هذا الشهر مسبقاً.');

  const lines: PayrollLine[] = preview.employees.flatMap((emp) => emp.lines);
  const key = idempotencyKey ?? (globalThis.crypto?.randomUUID?.() ?? `pr-${year}-${month}-${Date.now()}`);

  // عقد الحمولة (payload_version 2 — Migration 101): الإجماليات تُشتق من السطور
  // نفسها فتتطابق بالبناء، ثم تُقارن بإجماليات المعاينة لكشف أي انحراف في المحرك
  // مبكراً client-side قبل أن يرفضه الخادم بـ TOTALS_MISMATCH.
  const totalGross = round2(lines.filter((l) => !l.is_deduction).reduce((s, l) => s + l.amount, 0));
  const totalDeductions = round2(lines.filter((l) => l.is_deduction).reduce((s, l) => s + l.amount, 0));
  const totalNet = round2(totalGross - totalDeductions);
  const previewDeductions = round2(
    preview.totals.gosiEmployee + preview.totals.deductions + preview.totals.absence);
  if (Math.abs(totalGross - preview.totals.gross) > 0.011
    || Math.abs(totalDeductions - previewDeductions) > 0.011
    || Math.abs(totalNet - preview.totals.net) > 0.011) {
    throw new Error(
      `خلل عقد المسير: سطور (${totalGross}/${totalDeductions}/${totalNet}) ≠ معاينة `
      + `(${preview.totals.gross}/${previewDeductions}/${preview.totals.net}) — بلّغ عن المشكلة`);
  }

  const { data, error } = await supabase.rpc('rpc_post_payroll_run', {
    p_payload: {
      payload_version: 2,
      idempotency_key: key,
      year,
      month,
      total_gross: totalGross,
      total_deductions: totalDeductions,
      total_net: totalNet,
      totals: preview.buckets,
      lines,
    },
  });

  if (error) {
    if (error.code === 'PGRST202') {
      // fail-closed: لا مسار ترحيل client-side بديل (كان يتجاوز القناة القانونية)
      throw new Error('دالة اعتماد الرواتب غير منشورة — طبّق Migration 100 أولاً.');
    }
    throw new Error(translateRpcError(error.message));
  }

  const result = data as Record<string, unknown>;
  return {
    payroll_run_id: String(result.payroll_run_id ?? ''),
    journal_entry_id: String(result.journal_entry_id ?? ''),
    entry_number: result.entry_number ? String(result.entry_number) : undefined,
    replayed: result.replayed === true,
  };
}
