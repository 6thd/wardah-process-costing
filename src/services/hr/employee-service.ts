import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import type { HrEmployee } from './hr-service';

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
