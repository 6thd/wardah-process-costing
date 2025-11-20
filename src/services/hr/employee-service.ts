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


