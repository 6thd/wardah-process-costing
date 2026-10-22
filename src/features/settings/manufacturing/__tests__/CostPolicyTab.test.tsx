import { act, render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { CostPolicyState, CostPolicyVersion } from '@/services/mfg-cost-policy-service'
import { CostPolicyTab } from '../CostPolicyTab'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }))

const service = vi.hoisted(() => ({
  getCostPolicy: vi.fn(),
  createCostPolicyVersion: vi.fn(),
  withdrawCostPolicyVersion: vi.fn(),
  previewAbsorption: vi.fn(),
  listCostPolicyWorkCenters: vi.fn(),
}))
vi.mock('@/services/mfg-cost-policy-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/mfg-cost-policy-service')>()),
  ...service,
}))

const V1: CostPolicyVersion = {
  id: 'v1', version_no: 1, effective_from: '2026-10-22', status: 'current',
  labor_cost_source: 'work_center_rate', default_labor_rate_per_hour: 30, stage_costing_method: 'weighted_average',
  note: null, pinned_order_count: 2, withdraw_reason: null,
  overhead_pools: [
    { pool_code: 'LABOR_OH', name: 'Labor overhead', name_ar: null, basis: 'labor_hours', rate: 12 },
    { pool_code: 'MACHINE_OH', name: 'Machine overhead', name_ar: null, basis: 'machine_hours', rate: 40 },
  ],
  work_center_rules: [],
}
const V2: CostPolicyVersion = { ...V1, id: 'v2', version_no: 2, effective_from: '2026-11-21', status: 'scheduled', pinned_order_count: 0 }

function state(overrides: Partial<CostPolicyState> = {}): CostPolicyState {
  return {
    today: '2026-10-22', currentVersionId: 'v1', latestVersionNo: 2, versions: [V2, V1],
    supported: { labor_cost_sources: ['work_center_rate', 'recorded_entry_rate'], overhead_bases: ['labor_hours', 'machine_hours'], stage_costing_methods: ['weighted_average'] },
    canManage: true,
    ...overrides,
  }
}

beforeEach(async () => {
  for (const fn of Object.values(service)) fn.mockReset()
  toastError.mockReset()
  service.listCostPolicyWorkCenters.mockResolvedValue([
    { id: 'wc-a', code: 'WC-A', name: 'Mixing', nameAr: null },
    { id: 'wc-b', code: 'WC-B', name: 'Packing', nameAr: null },
  ])
  await act(async () => { await i18n.changeLanguage('en') })
})

describe('CostPolicyTab', () => {
  it('says the feature is not available where Migration 204 is not applied, and offers nothing to save', async () => {
    service.getCostPolicy.mockRejectedValue(new Error('COST_POLICY_NOT_DEPLOYED'))
    render(<CostPolicyTab />)

    expect(await screen.findByText(/Migration 204 has not been applied/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New version' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('is read-only without the database capability', async () => {
    service.getCostPolicy.mockResolvedValue(state({ canManage: false }))
    render(<CostPolicyTab />)

    expect(await screen.findByTestId('cp-version-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New version' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument()
  })

  it('offers withdrawal only for the scheduled, unpinned version, and requires a reason', async () => {
    service.getCostPolicy.mockResolvedValue(state())
    service.withdrawCostPolicyVersion.mockResolvedValue(state())
    const user = userEvent.setup()
    render(<CostPolicyTab />)

    const scheduled = await screen.findByTestId('cp-version-2')
    expect(within(screen.getByTestId('cp-version-1')).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument()
    await user.click(within(scheduled).getByRole('button', { name: 'Withdraw' }))
    await user.type(screen.getByLabelText('Reason for withdrawal'), 'Rates not approved')
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))

    await waitFor(() => expect(service.withdrawCostPolicyVersion).toHaveBeenCalledWith('v2', 'Rates not approved'))
  })

  it('publishes a version built from the form, with work-center override and exclusion, against the loaded latest version', async () => {
    service.getCostPolicy.mockResolvedValue(state({ versions: [V1], latestVersionNo: 1 }))
    service.createCostPolicyVersion
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue({ state: state(), versionId: 'v2', replayed: true })
    const user = userEvent.setup()
    render(<CostPolicyTab />)

    await user.click(await screen.findByRole('button', { name: 'New version' }))
    const form = screen.getByRole('form', { name: 'New cost policy version' })
    // Only implemented options are offered.
    expect(within(within(form).getByLabelText('Labor cost source')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Labor hours × work-center rate', 'Recorded cost of time entries'])

    const effective = within(form).getByLabelText('Effective from')
    await user.clear(effective)
    await user.type(effective, '2026-11-01')
    await user.click(within(form).getByRole('button', { name: 'Add work-center rule' }))
    const rule = within(form).getByTestId('cp-rule-row')
    await waitFor(() => expect(within(rule).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(within(rule).getByLabelText('Work center'), 'wc-a')
    await user.type(within(rule).getByLabelText('Labor rate override'), '35')
    await user.selectOptions(within(rule).getByLabelText('Rule for MACHINE_OH'), 'override')
    await user.type(within(rule).getByLabelText('Rate for MACHINE_OH'), '55')
    await user.selectOptions(within(rule).getByLabelText('Rule for LABOR_OH'), 'exclude')

    await user.click(within(form).getByRole('button', { name: 'Publish version' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to fetch'))
    // Retry after a lost response: same idempotency key, so the database replays.
    await user.click(within(form).getByRole('button', { name: 'Publish version' }))

    await waitFor(() => expect(service.createCostPolicyVersion).toHaveBeenCalledTimes(2))
    const [firstDraft, expected, firstKey] = service.createCostPolicyVersion.mock.calls[0]
    const [, , secondKey] = service.createCostPolicyVersion.mock.calls[1]
    expect(expected).toBe(1)
    expect(secondKey).toBe(firstKey)
    expect(firstDraft).toEqual({
      effective_from: '2026-11-01',
      labor_cost_source: 'work_center_rate',
      default_labor_rate_per_hour: 30,
      overhead_pools: [
        { pool_code: 'LABOR_OH', name: 'Labor overhead', basis: 'labor_hours', rate: 12 },
        { pool_code: 'MACHINE_OH', name: 'Machine overhead', basis: 'machine_hours', rate: 40 },
      ],
      work_center_rules: [{
        work_center_id: 'wc-a',
        labor_rate_per_hour: 35,
        pools: [
          { pool_code: 'MACHINE_OH', applies: true, rate: 55 },
          { pool_code: 'LABOR_OH', applies: false },
        ],
      }],
    })
  })

  it('previews absorption and sends an empty driver as NULL, never as zero', async () => {
    service.getCostPolicy.mockResolvedValue(state())
    service.previewAbsorption.mockResolvedValue({
      labor: { source: 'work_center_rate', hours: 10, rate_per_hour: 35, rate_source: 'work_center_rule', amount: 350 },
      overhead: [{ pool_code: 'MACHINE_OH', basis: 'machine_hours', driver_hours: 6, rate_per_hour: 55, rate_source: 'work_center_rule', amount: 330 }],
      excluded_pools: ['LABOR_OH'], overhead_total: 330, total: 680,
    })
    const user = userEvent.setup()
    render(<CostPolicyTab />)

    await screen.findByTestId('cp-version-1')
    const versionSelect = screen.getByLabelText('Version')
    await user.selectOptions(versionSelect, 'v1')
    const workCenter = screen.getAllByLabelText('Work center').at(-1) as HTMLSelectElement
    await waitFor(() => expect(within(workCenter).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(workCenter, 'wc-a')
    await user.type(screen.getByLabelText('Labor hours'), '10')
    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    await waitFor(() => expect(service.previewAbsorption).toHaveBeenCalledWith({
      versionId: 'v1', workCenterId: 'wc-a', laborHours: 10, machineHours: null, recordedLaborCost: null,
    }))
    const result = await screen.findByRole('table', { name: 'Absorption result' })
    expect(within(result).getByText('330.00')).toBeInTheDocument()
    expect(within(result).getByText('680.00')).toBeInTheDocument()
    expect(within(result).getByText(/excluded at this work center/)).toBeInTheDocument()
  })
})
