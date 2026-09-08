import { getEffectiveTenantId, supabase } from '@/lib/supabase';

const REPORT_PAGE_SIZE = 1000;

export interface ReportEmployee {
  id: string;
  employee_id: string;
  full_name: string | null;
  department: string | null;
  position: string | null;
  status: string | null;
  hire_date: string;
  termination_date: string | null;
}

export interface ReportPayrollRun {
  id: string;
  period_id: string;
  run_date: string;
  status: string | null;
  total_gross: number | null;
  total_deductions: number | null;
  total_net: number | null;
}

interface TenantScopedOptions {
  orgId?: string;
}

interface PayrollReportOptions extends TenantScopedOptions {
  from: string;
  to: string;
}

async function resolveReportOrgId(orgId?: string): Promise<string> {
  const resolved = orgId ?? await getEffectiveTenantId();
  if (!resolved) throw new Error('Organization not found.');
  return resolved;
}

export async function listEmployeesForReports(
  options: TenantScopedOptions = {},
): Promise<ReportEmployee[]> {
  const orgId = await resolveReportOrgId(options.orgId);
  const rows: ReportEmployee[] = [];

  for (let from = 0; ; from += REPORT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('employees')
      .select(
        'id, employee_id, full_name, department, position, status, hire_date, termination_date',
      )
      .eq('org_id', orgId)
      .order('id', { ascending: true })
      .range(from, from + REPORT_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as ReportEmployee[];
    rows.push(...page);
    if (page.length < REPORT_PAGE_SIZE) break;
  }

  return rows;
}

export async function listPayrollRunsForReport({
  orgId: suppliedOrgId,
  from: dateFrom,
  to: dateTo,
}: PayrollReportOptions): Promise<ReportPayrollRun[]> {
  const orgId = await resolveReportOrgId(suppliedOrgId);
  const rows: ReportPayrollRun[] = [];

  for (let from = 0; ; from += REPORT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('payroll_runs')
      .select(
        'id, period_id, run_date, status, total_gross, total_deductions, total_net',
      )
      .eq('org_id', orgId)
      .gte('run_date', dateFrom)
      .lte('run_date', dateTo)
      .order('run_date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + REPORT_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as ReportPayrollRun[];
    rows.push(...page);
    if (page.length < REPORT_PAGE_SIZE) break;
  }

  return rows;
}
