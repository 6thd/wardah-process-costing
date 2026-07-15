import { supabase as _supabase, getEffectiveTenantId } from '@/lib/supabase';
import type { HrEmployee } from './hr-service';
const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

export interface CreateEmployeeInput {
  firstName: string;
  lastName: string;
  employeeCode: string;
  hireDate: string;
  department?: string;
  position?: string;
  salary?: number;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<HrEmployee> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) {
    throw new Error('Organization (org_id) not found for current user.');
  }

  const payload: any = {
    org_id: orgId,
    employee_id: input.employeeCode,
    first_name: input.firstName,
    last_name: input.lastName,
    hire_date: input.hireDate,
    status: 'active',
    department: input.department || null,
    position: input.position || null,
    salary: input.salary ?? 0,
  };

  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    console.error('Failed to create employee:', error);
    throw error;
  }

  return {
    id: data.id,
    code: data.employee_id,
    name: data.full_name || `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim(),
    jobTitle: data.position ?? undefined,
    department: data.department ?? undefined,
    status: data.status ?? 'active',
    hiringDate: data.hire_date ?? null,
    contractEndDate: data.termination_date ?? null,
    salary: Number(data.salary ?? 0),
    currency: data.currency ?? 'SAR',
    location: null,
    avatarUrl: null,
  };
}



/**
 * حذف موظف (org-scoped). عند وجود سجلات مرتبطة (رواتب/حضور/إجازات) يفشل الحذف
 * الفعلي بقيد FK — نعيد رسالة واضحة تقترح إنهاء الخدمة بدل الحذف (لا فقد سجلات).
 */
export async function deleteEmployee(id: string): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) {
    throw new Error('Organization (org_id) not found for current user.');
  }

  const { error } = await supabase
    .from('employees')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    console.error('Failed to delete employee:', error);
    if (error.code === '23503') { // foreign_key_violation
      throw new Error('لا يمكن حذف الموظف لوجود سجلات مرتبطة (رواتب/حضور/إجازات) — استخدم إنهاء الخدمة بدل الحذف.');
    }
    throw new Error(error.message);
  }
}

export interface EmployeeSalaryComponent {
  id: string;
  componentName: string;
  componentType: string; // earning | deduction ...
  value: number;
}

export interface SalaryComponentOption {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  component_type: string;
  calculation_type: string;
}

/** قائمة مكوّنات الراتب المتاحة للمنظمة (للاختيار منها عند الإسناد). */
export async function listSalaryComponents(): Promise<SalaryComponentOption[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('salary_components')
    .select('id, code, name, name_ar, component_type, calculation_type')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('component_type', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as SalaryComponentOption[];
}

export interface UpsertSalaryStructureInput {
  component_id: string;
  amount: number;          // القيمة الثابتة أو النسبة
  calculation_type?: 'fixed' | 'percentage';
  /** أساس النسبة — يُحفظ على تعريف المكوّن (salary_components) ويسري org-wide */
  percentage_base?: 'basic' | 'basic_housing';
}

/** إسناد / تعديل مكوّن راتب لموظف (تعطيل القديم + إدراج جديد). */
export async function upsertEmployeeSalaryComponent(
  employeeId: string,
  input: UpsertSalaryStructureInput,
): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');
  if (input.amount <= 0) throw new Error('القيمة يجب أن تكون موجبة');

  // المحرك يقرأ calculation_type/percentage_base من تعريف المكوّن — كانت قيمة
  // الحوار تُهمل بصمت (P2-13) فيبدو نوع الحساب قابلاً للضبط بينما لا يتغير شيء
  if (input.calculation_type) {
    const { error: compUpdateErr } = await supabase
      .from('salary_components')
      .update({
        calculation_type: input.calculation_type,
        percentage_base: input.calculation_type === 'percentage'
          ? (input.percentage_base ?? 'basic')
          : null,
      })
      .eq('org_id', orgId)
      .eq('id', input.component_id);
    if (compUpdateErr) throw new Error(compUpdateErr.message);
  }

  // تعطيل أي سجل نشط حالي لنفس المكوّن
  await supabase
    .from('employee_salary_structures')
    .update({ is_active: false })
    .eq('org_id', orgId)
    .eq('employee_id', employeeId)
    .eq('component_id', input.component_id)
    .eq('is_active', true);

  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase.from('employee_salary_structures').insert({
    org_id: orgId,
    employee_id: employeeId,
    component_id: input.component_id,
    value: input.amount,
    effective_from: today,
    is_active: true,
  });

  if (error) throw new Error(error.message);
}

/** تعطيل مكوّن راتب لموظف (soft-delete). */
export async function deactivateEmployeeSalaryComponent(
  structureId: string,
): Promise<void> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { error } = await supabase
    .from('employee_salary_structures')
    .update({ is_active: false })
    .eq('id', structureId)
    .eq('org_id', orgId);

  if (error) throw new Error(error.message);
}

export interface PayrollDetailRow {
  id: string;
  employee_id: string;
  component_code: string | null;
  component_label: string | null;
  amount: number;
  is_deduction: boolean;
}

/** سطور تفصيل المسير لموظف من دورة مُعتمدة. */
export async function getPayrollDetailsForEmployee(
  runId: string,
  employeeId: string,
): Promise<PayrollDetailRow[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('Organization not found.');

  const { data, error } = await supabase
    .from('payroll_details')
    .select('id, employee_id, component_code, component_label, amount, is_deduction')
    .eq('org_id', orgId)
    .eq('payroll_run_id', runId)
    .eq('employee_id', employeeId)
    .order('is_deduction', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as PayrollDetailRow[];
}

/** بدلات/استقطاعات الموظف الفعّالة من employee_salary_structures × salary_components. */
export async function getEmployeeSalaryComponents(employeeId: string): Promise<EmployeeSalaryComponent[]> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) {
    throw new Error('Organization (org_id) not found for current user.');
  }

  const { data, error } = await supabase
    .from('employee_salary_structures')
    .select('id, value, is_active, component:salary_components(name, name_ar, component_type)')
    .eq('org_id', orgId)
    .eq('employee_id', employeeId)
    .eq('is_active', true);

  if (error) {
    console.error('Failed to fetch salary components:', error);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    componentName: row.component?.name_ar || row.component?.name || '—',
    componentType: row.component?.component_type || '',
    value: Number(row.value ?? 0),
  }));
}
