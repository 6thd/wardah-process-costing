import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type QueryResult = { data: any; error: any }

const db = vi.hoisted(() => {
  const responses: QueryResult[] = []
  const calls = {
    from: [] as string[],
    select: [] as any[][],
    insert: [] as any[][],
    update: [] as any[][],
    upsert: [] as any[][],
    delete: [] as any[][],
    eq: [] as any[][],
    order: [] as any[][],
    or: [] as any[][],
    limit: [] as any[][],
  }

  const takeResponse = () =>
    Promise.resolve(responses.shift() ?? { data: null, error: null })

  const from = vi.fn((table: string) => {
    calls.from.push(table)
    const chain: Record<string, any> = {}

    for (const method of [
      'select',
      'insert',
      'update',
      'upsert',
      'delete',
      'eq',
      'order',
      'or',
      'limit',
    ] as const) {
      chain[method] = vi.fn((...args: any[]) => {
        calls[method].push(args)
        return chain
      })
    }

    chain.single = vi.fn(takeResponse)
    chain.maybeSingle = vi.fn(takeResponse)
    chain.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      takeResponse().then(resolve, reject)
    return chain
  })

  return {
    responses,
    calls,
    from,
    getTenant: vi.fn(),
    getUser: vi.fn(),
  }
})

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: db.getTenant,
  supabase: {
    from: db.from,
    auth: { getUser: db.getUser },
  },
}))

import {
  createEmployee,
  deactivateEmployeeSalaryComponent,
  deleteEmployee,
  getEmployeeSalaryComponents,
  getPayrollDetailsForEmployee,
  listSalaryComponents,
  upsertEmployeeSalaryComponent,
} from '../employee-service'
import { generateAlerts, listAlerts, resolveAlert } from '../alert-service'
import {
  createAdjustment,
  deleteAdjustment,
  listAdjustmentsForMonth,
} from '../adjustments-service'
import { checkIsPayrollAdmin } from '../payroll-admin-service'

const ok = (data: any = null): QueryResult => ({ data, error: null })
const failed = (message = 'database failed', code?: string): QueryResult => ({
  data: null,
  error: { message, code },
})

describe('HR data services', () => {
  beforeEach(() => {
    db.responses.length = 0
    for (const values of Object.values(db.calls)) values.length = 0
    db.from.mockClear()
    db.getTenant.mockReset().mockResolvedValue('org-1')
    db.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('employee service', () => {
    it('creates and maps an employee inside the active organization', async () => {
      db.responses.push(ok({
        id: 'emp-1', employee_id: 'E-001', full_name: 'موظف تجريبي',
        first_name: 'موظف', last_name: 'تجريبي', position: 'محاسب',
        department: 'المالية', status: null, hire_date: '2026-01-01',
        termination_date: null, salary: '9000', currency: null,
      }))

      const employee = await createEmployee({
        firstName: 'موظف', lastName: 'تجريبي', employeeCode: 'E-001',
        hireDate: '2026-01-01', department: 'المالية', position: 'محاسب', salary: 9000,
      })

      expect(employee).toMatchObject({
        id: 'emp-1', code: 'E-001', name: 'موظف تجريبي', salary: 9000,
        status: 'active', currency: 'SAR', location: null, avatarUrl: null,
      })
      expect(db.calls.insert[0][0]).toMatchObject({ org_id: 'org-1', employee_id: 'E-001' })
    })

    it('uses safe defaults for optional create fields and propagates insert errors', async () => {
      db.responses.push(ok({
        id: 'emp-2', employee_id: 'E-002', first_name: 'First', last_name: 'Last',
        position: null, department: null, status: 'inactive', hire_date: null,
        termination_date: '2026-12-31', salary: null, currency: 'USD',
      }))
      await expect(createEmployee({
        firstName: 'First', lastName: 'Last', employeeCode: 'E-002', hireDate: '2026-02-01',
      })).resolves.toMatchObject({ name: 'First Last', salary: 0, currency: 'USD' })
      expect(db.calls.insert[0][0]).toMatchObject({ department: null, position: null, salary: 0 })

      db.responses.push(failed('duplicate employee'))
      await expect(createEmployee({
        firstName: 'A', lastName: 'B', employeeCode: 'E-002', hireDate: '2026-02-01',
      })).rejects.toMatchObject({ message: 'duplicate employee' })
    })

    it('fails closed when employee operations have no organization', async () => {
      db.getTenant.mockResolvedValue(null)
      const createInput = {
        firstName: 'A', lastName: 'B', employeeCode: 'E-003', hireDate: '2026-01-01',
      }

      await expect(createEmployee(createInput)).rejects.toThrow('org_id')
      await expect(deleteEmployee('emp-1')).rejects.toThrow('org_id')
      await expect(listSalaryComponents()).rejects.toThrow('Organization not found')
      await expect(upsertEmployeeSalaryComponent('emp-1', { component_id: 'c-1', amount: 1 }))
        .rejects.toThrow('Organization not found')
      await expect(deactivateEmployeeSalaryComponent('s-1')).rejects.toThrow('Organization not found')
      await expect(getPayrollDetailsForEmployee('run-1', 'emp-1')).rejects.toThrow('Organization not found')
      await expect(getEmployeeSalaryComponents('emp-1')).rejects.toThrow('org_id')
      expect(db.from).not.toHaveBeenCalled()
    })

    it('deletes an employee and maps foreign-key and ordinary failures', async () => {
      db.responses.push(ok())
      await expect(deleteEmployee('emp-1')).resolves.toBeUndefined()
      expect(db.calls.eq).toContainEqual(['org_id', 'org-1'])

      db.responses.push(failed('linked rows', '23503'))
      await expect(deleteEmployee('emp-1')).rejects.toThrow('استخدم إنهاء الخدمة')

      db.responses.push(failed('delete denied', '42501'))
      await expect(deleteEmployee('emp-1')).rejects.toThrow('delete denied')
    })

    it('lists salary components and handles empty and failed queries', async () => {
      const component = {
        id: 'c-1', code: 'HOUSING', name: 'Housing', name_ar: 'بدل سكن',
        component_type: 'earning', calculation_type: 'fixed',
      }
      db.responses.push(ok([component]), ok([]), failed('components unavailable'))
      await expect(listSalaryComponents()).resolves.toEqual([component])
      await expect(listSalaryComponents()).resolves.toEqual([])
      await expect(listSalaryComponents()).rejects.toThrow('components unavailable')
      expect(db.calls.order).toContainEqual(['component_type', { ascending: true }])
    })

    it('upserts percentage and fixed salary structures and validates the amount', async () => {
      await expect(upsertEmployeeSalaryComponent('emp-1', { component_id: 'c-1', amount: 0 }))
        .rejects.toThrow('موجبة')

      db.responses.push(ok(), ok(), ok())
      await upsertEmployeeSalaryComponent('emp-1', {
        component_id: 'c-1', amount: 25, calculation_type: 'percentage',
        percentage_base: 'basic_housing',
      })
      expect(db.calls.update[0][0]).toEqual({
        calculation_type: 'percentage', percentage_base: 'basic_housing',
      })
      expect(db.calls.insert[0][0]).toMatchObject({
        org_id: 'org-1', employee_id: 'emp-1', component_id: 'c-1', value: 25, is_active: true,
      })

      db.responses.push(ok(), ok(), ok())
      await upsertEmployeeSalaryComponent('emp-1', {
        component_id: 'c-2', amount: 500, calculation_type: 'fixed',
      })
      expect(db.calls.update[2][0]).toEqual({ calculation_type: 'fixed', percentage_base: null })
    })

    it('surfaces salary definition and structure insert failures', async () => {
      db.responses.push(failed('component update denied'))
      await expect(upsertEmployeeSalaryComponent('emp-1', {
        component_id: 'c-1', amount: 10, calculation_type: 'percentage',
      })).rejects.toThrow('component update denied')

      db.responses.push(ok(), failed('structure insert denied'))
      await expect(upsertEmployeeSalaryComponent('emp-1', {
        component_id: 'c-1', amount: 10,
      })).rejects.toThrow('structure insert denied')
    })

    it('deactivates structures and propagates failures', async () => {
      db.responses.push(ok(), failed('deactivate denied'))
      await expect(deactivateEmployeeSalaryComponent('s-1')).resolves.toBeUndefined()
      await expect(deactivateEmployeeSalaryComponent('s-1')).rejects.toThrow('deactivate denied')
    })

    it('loads payroll details and maps salary component fallbacks', async () => {
      const detail = {
        id: 'd-1', employee_id: 'emp-1', component_code: 'BASIC',
        component_label: 'Basic', amount: 1000, is_deduction: false,
      }
      db.responses.push(ok([detail]), ok([]))
      await expect(getPayrollDetailsForEmployee('run-1', 'emp-1')).resolves.toEqual([detail])
      await expect(getPayrollDetailsForEmployee('run-1', 'emp-1')).resolves.toEqual([])

      db.responses.push(ok([
        { id: 's-1', value: '20', component: { name_ar: 'عربي', name: 'English', component_type: 'earning' } },
        { id: 's-2', value: null, component: { name_ar: '', name: 'English', component_type: null } },
        { id: 's-3', value: 5, component: null },
      ]))
      await expect(getEmployeeSalaryComponents('emp-1')).resolves.toEqual([
        { id: 's-1', componentName: 'عربي', componentType: 'earning', value: 20 },
        { id: 's-2', componentName: 'English', componentType: '', value: 0 },
        { id: 's-3', componentName: '—', componentType: '', value: 5 },
      ])
    })

    it('surfaces payroll detail and salary component query failures', async () => {
      db.responses.push(failed('details failed'), failed('structures failed'))
      await expect(getPayrollDetailsForEmployee('run-1', 'emp-1')).rejects.toThrow('details failed')
      await expect(getEmployeeSalaryComponents('emp-1')).rejects.toThrow('structures failed')
    })
  })

  describe('alert service', () => {
    it('lists and resolves alerts with tenant-scoped filters', async () => {
      const alert = { id: 'a-1', org_id: 'org-1', is_resolved: false }
      db.responses.push(ok([alert]), ok())
      await expect(listAlerts(10)).resolves.toEqual([alert])
      await expect(resolveAlert('a-1')).resolves.toBeUndefined()
      expect(db.calls.limit).toContainEqual([10])
      expect(db.calls.update[0][0]).toMatchObject({ is_resolved: true })
    })

    it('fails alert reads and writes closed', async () => {
      db.getTenant.mockResolvedValueOnce(null)
      await expect(listAlerts()).rejects.toThrow('Organization not found')
      db.getTenant.mockResolvedValueOnce(null)
      await expect(resolveAlert('a-1')).rejects.toThrow('Organization not found')

      db.responses.push(failed('alerts failed'), failed('resolve failed'))
      await expect(listAlerts()).rejects.toThrow('alerts failed')
      await expect(resolveAlert('a-1')).rejects.toThrow('resolve failed')
    })

    it('generates contract and missing-IBAN alerts with all severity bands', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))
      db.responses.push(ok([
        { id: 'e-1', full_name: 'Critical', contract_end_date: '2026-08-20', hire_date: null, iban: null },
        { id: 'e-2', full_name: 'Warning', contract_end_date: '2026-08-28', hire_date: null, iban: 'SA1' },
        { id: 'e-3', full_name: null, contract_end_date: '2026-09-10', hire_date: null, iban: 'SA2' },
        { id: 'e-4', full_name: 'Expired', contract_end_date: '2026-08-01', hire_date: null, iban: 'SA3' },
      ]), ok())

      await expect(generateAlerts()).resolves.toBe(4)
      const rows = db.calls.upsert[0][0]
      expect(rows.map((row: any) => row.severity)).toEqual(['critical', 'warning', 'warning', 'info'])
      expect(rows.every((row: any) => row.is_resolved === false)).toBe(true)
      expect(db.calls.upsert[0][1]).toEqual({
        onConflict: 'org_id,employee_id,title', ignoreDuplicates: false,
      })
    })

    it('returns zero for no generated alerts and falls back from upsert to insert', async () => {
      db.responses.push(ok([{ id: 'e-1', full_name: 'Complete', contract_end_date: null, iban: 'SA1' }]))
      await expect(generateAlerts()).resolves.toBe(0)

      db.responses.push(
        ok([{ id: 'e-2', full_name: 'Missing', contract_end_date: null, iban: null }]),
        failed('unique constraint missing'),
        ok(),
      )
      await expect(generateAlerts()).resolves.toBe(1)
      expect(db.calls.insert.at(-1)?.[0]).toHaveLength(1)
    })

    it('surfaces employee reads and fallback inserts that fail', async () => {
      db.getTenant.mockResolvedValueOnce(null)
      await expect(generateAlerts()).rejects.toThrow('Organization not found')

      db.responses.push(failed('employees failed'))
      await expect(generateAlerts()).rejects.toThrow('employees failed')

      db.responses.push(
        ok([{ id: 'e-1', full_name: 'Missing', contract_end_date: null, iban: null }]),
        failed('upsert failed'),
        failed('insert failed'),
      )
      await expect(generateAlerts()).rejects.toThrow('insert failed')
    })
  })

  describe('payroll adjustments', () => {
    it('lists the selected month and creates normalized adjustments', async () => {
      const adjustment = { id: 'adj-1', amount: 500 }
      db.responses.push(ok([adjustment]), ok(adjustment), ok({ id: 'adj-2', amount: 100 }))
      await expect(listAdjustmentsForMonth(2026, 8)).resolves.toEqual([adjustment])
      expect(db.calls.or[0][0]).toContain('effective_month.eq.2026-08-01')

      await expect(createAdjustment({
        employee_id: 'emp-1', adjustment_type: 'allowance', description: 'Bonus',
        amount: 500, is_recurring: true, effective_month: '2026-08',
      })).resolves.toEqual(adjustment)
      expect(db.calls.insert.at(-1)?.[0]).toMatchObject({
        org_id: 'org-1', is_recurring: true, effective_month: '2026-08-01',
      })

      await createAdjustment({ employee_id: 'emp-1', adjustment_type: 'deduction', amount: 100 })
      expect(db.calls.insert.at(-1)?.[0]).toMatchObject({
        description: null, is_recurring: false, effective_month: null,
      })
    })

    it('validates adjustments and fails closed without an organization', async () => {
      await expect(createAdjustment({ employee_id: 'e', adjustment_type: 'loan', amount: 0 }))
        .rejects.toThrow('موجباً')
      await expect(createAdjustment({ employee_id: 'e', adjustment_type: 'loan', amount: -1 }))
        .rejects.toThrow('موجباً')

      db.getTenant.mockResolvedValue(null)
      await expect(listAdjustmentsForMonth(2026, 8)).rejects.toThrow('Organization not found')
      await expect(createAdjustment({ employee_id: 'e', adjustment_type: 'loan', amount: 1 }))
        .rejects.toThrow('Organization not found')
      await expect(deleteAdjustment('adj-1')).rejects.toThrow('Organization not found')
    })

    it('deletes adjustments and propagates database failures', async () => {
      db.responses.push(ok(), failed('list failed'), failed('create failed'), failed('delete failed'))
      await expect(deleteAdjustment('adj-1')).resolves.toBeUndefined()
      await expect(listAdjustmentsForMonth(2026, 8)).rejects.toThrow('list failed')
      await expect(createAdjustment({ employee_id: 'e', adjustment_type: 'loan', amount: 1 }))
        .rejects.toThrow('create failed')
      await expect(deleteAdjustment('adj-1')).rejects.toThrow('delete failed')
    })
  })

  describe('payroll admin display gate', () => {
    it('accepts explicit org-admin, admin, and owner records', async () => {
      for (const record of [
        { is_org_admin: true, role: 'member' },
        { is_org_admin: false, role: 'admin' },
        { is_org_admin: false, role: 'owner' },
      ]) {
        db.responses.push(ok(record))
        await expect(checkIsPayrollAdmin()).resolves.toBe(true)
      }
    })

    it('rejects missing tenant, user, record, ordinary role, and query errors', async () => {
      db.getTenant.mockResolvedValueOnce(null)
      await expect(checkIsPayrollAdmin()).resolves.toBe(false)

      db.getUser.mockResolvedValueOnce({ data: { user: null } })
      await expect(checkIsPayrollAdmin()).resolves.toBe(false)

      db.responses.push(ok(null), ok({ is_org_admin: false, role: 'member' }), failed('denied'))
      await expect(checkIsPayrollAdmin()).resolves.toBe(false)
      await expect(checkIsPayrollAdmin()).resolves.toBe(false)
      await expect(checkIsPayrollAdmin()).resolves.toBe(false)
    })

    it('fails closed when identity resolution throws', async () => {
      db.getTenant.mockRejectedValueOnce(new Error('identity unavailable'))
      await expect(checkIsPayrollAdmin()).resolves.toBe(false)
    })
  })
})
