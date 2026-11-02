import { act, render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { focusManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { cp205Response, ORG, SESSION_USER } from '@/services/__tests__/fixtures/cost-policy-205'
import pg17 from '@/services/__tests__/fixtures/cost-policy-205-get.pg17.json'
import { CostPolicyTab } from '../CostPolicyTab'

// The real services run against this client, so every RPC the tab reaches is recorded.
const rpc = vi.fn()
// The organization chosen in the selector. The session resolver follows it, as the server would.
let authOrg: string | null = ORG
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ currentOrgId: authOrg }) }))
vi.mock('@/lib/supabase', () => {
  const chain = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: [], error: null }) }
  return {
    supabase: {
      rpc: (...args: unknown[]) => rpc(...args),
      from: () => chain,
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: SESSION_USER } } } }) },
    },
    getEffectiveTenantId: () => Promise.resolve(authOrg),
  }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const ORG_B = '52050205-0000-0000-0000-0000000000b1'
const ABSENT = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.rpc_get_mfg_cost_policy_205(p_org_id) in the schema cache' } }
const STATE_204 = {
  org_id: ORG, today: '2026-10-22', current_version_id: 'v1', latest_version_no: 1,
  versions: [{
    id: 'v1', version_no: 1, effective_from: '2026-10-22', status: 'current', labor_cost_source: 'work_center_rate',
    default_labor_rate_per_hour: 30, stage_costing_method: 'weighted_average', pin_event: 'mo_created', note: null,
    pinned_order_count: 1, awaiting_start_order_count: 0, withdraw_reason: null,
    overhead_pools: [{ pool_code: 'LABOR_OH', name: 'Labor overhead', name_ar: null, basis: 'labor_hours', rate: 12 }],
    work_center_rules: [],
  }],
  supported: { labor_cost_sources: ['work_center_rate', 'recorded_entry_rate'], overhead_bases: ['labor_hours', 'machine_hours'], stage_costing_methods: ['weighted_average'], pin_events: ['mo_created', 'production_started'] },
  capabilities: { can_manage: true },
}
const WRITES = [
  'rpc_create_mfg_cost_policy_version', 'rpc_withdraw_mfg_cost_policy_version',
  'rpc_create_mfg_cost_policy_draft_205', 'rpc_update_mfg_cost_policy_draft_205', 'rpc_withdraw_mfg_cost_policy_draft_205',
  'rpc_reject_mfg_cost_policy_draft_205', 'rpc_approve_mfg_cost_policy_draft_205', 'rpc_create_legacy_resolution_draft_205',
  'rpc_set_cost_policy_self_approval_205', 'rpc_set_cost_policy_unallocated_policy_205',
]
const called = () => rpc.mock.calls.map(c => c[0] as string)

function route(responses: Record<string, unknown>) {
  rpc.mockImplementation(async (fn: string) => {
    const r = responses[fn]
    if (r === undefined) throw new Error(`unexpected RPC ${fn}`)
    return typeof r === 'function' ? (r as () => unknown)() : r
  })
}

beforeEach(async () => {
  rpc.mockReset()
  authOrg = ORG
  await act(async () => { await i18n.changeLanguage('en') })
})
// A failed focus test must not leave the window focused for the next one.
afterEach(() => { act(() => { focusManager.setFocused(undefined) }) })

describe('CostPolicyTab: discovery of 205 and the two panels', () => {
  it('absent: shows the 204 panel, with creation disabled under the freeze and nothing written', async () => {
    route({ rpc_get_mfg_cost_policy_205: ABSENT, rpc_get_mfg_cost_policy: { data: STATE_204, error: null } })
    render(<CostPolicyTab />)

    expect(await screen.findByTestId('cp-version-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New version' })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent(/stopped by the administrative freeze/)
    expect(screen.queryByRole('form', { name: 'New cost policy version' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('cp205-panel')).not.toBeInTheDocument()
    expect(called()).toEqual(['rpc_get_mfg_cost_policy_205', 'rpc_get_mfg_cost_policy'])
  })

  it('absent is not remembered: when the user comes back to the tab it checks again and shows 205', async () => {
    let applied = false
    route({
      rpc_get_mfg_cost_policy_205: () => (applied ? { data: cp205Response(), error: null } : ABSENT),
      rpc_get_mfg_cost_policy: { data: STATE_204, error: null },
    })
    render(<CostPolicyTab />)
    expect(await screen.findByTestId('cp-version-1')).toBeInTheDocument()

    applied = true
    act(() => { focusManager.setFocused(false) })
    act(() => { focusManager.setFocused(true) })

    expect(await screen.findByTestId('cp205-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('cp-version-1')).not.toBeInTheDocument()
    act(() => { focusManager.setFocused(undefined) })
  })

  it('present: shows the 205 panel read-only, whatever the capabilities say, and reaches no other RPC', async () => {
    route({ rpc_get_mfg_cost_policy_205: { data: cp205Response(), error: null } })
    render(<CostPolicyTab />)

    const panel = await screen.findByTestId('cp205-panel')
    // Every capability is true in the fixture, and still no button and no form: writes come in UI-2.
    expect(within(panel).queryAllByRole('button')).toHaveLength(0)
    expect(within(panel).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument()
    // The old create path and the 204 preview are absent.
    expect(screen.queryByRole('button', { name: 'New version' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Absorption result' })).not.toBeInTheDocument()
    expect(screen.getByText(/read-only/)).toBeInTheDocument()
    expect(screen.getByTestId('cp205-freeze')).toBeInTheDocument()
    expect(called()).toEqual(['rpc_get_mfg_cost_policy_205'])
    expect(called().some(fn => WRITES.includes(fn))).toBe(false)
  })

  it('present: shows the paths, the stale draft, the unloaded budgets in riyal as sent, the legacy version and the decisions', async () => {
    route({ rpc_get_mfg_cost_policy_205: { data: cp205Response(), error: null } })
    render(<CostPolicyTab />)

    expect(await screen.findByTestId('cp205-panel')).toBeInTheDocument()
    expect(screen.getByTestId('cp205-self-approval')).toHaveTextContent('Off')
    expect(screen.getByTestId('cp205-unallocated-policy')).toHaveTextContent('Allowed as a controlled exception')

    const v2 = screen.getByTestId('cp205-version-2')
    expect(within(v2).getByText('Approved (205)')).toBeInTheDocument()
    expect(within(v2).getByText(/run and setup/)).toBeInTheDocument()
    expect(within(v2).getByText(/Revision 3 approved/)).toBeInTheDocument()
    const exception = within(v2).getByTestId('cp205-exception-2')
    // Stored in riyal: shown as 4800.50, never as 480050 or 48.00.
    expect(within(exception).getByText(/4800\.50 SAR/)).toBeInTheDocument()
    expect(within(v2).getByText(/15000\.00 SAR/)).toBeInTheDocument()
    expect(within(screen.getByTestId('cp205-version-1')).getByText('Legacy, not resolved')).toBeInTheDocument()

    const stale = screen.getByTestId('cp205-draft-draft-stale')
    expect(within(stale).getByText(/Saved against version 1; the latest is now 2/)).toBeInTheDocument()
    expect(within(stale).getByText(/by You/)).toBeInTheDocument()
    expect(within(screen.getByTestId('cp205-draft-unallocated-draft-stale')).getByText(/4800\.50 SAR/)).toBeInTheDocument()
    expect(within(screen.getByTestId('cp205-draft-draft-legacy')).getByText(/by 52050205/)).toBeInTheDocument()

    const legacy = screen.getByTestId('cp205-legacy-1')
    expect(within(legacy).getByText(/Orders pinned: 2/)).toBeInTheDocument()
    expect(within(legacy).getByText(/version in force/)).toBeInTheDocument()
    expect(within(legacy).getByText(/resolution draft is awaiting/)).toBeInTheDocument()

    expect(within(screen.getByTestId('cp205-history-draft-rejected')).getByText('rates not agreed')).toBeInTheDocument()
    expect(within(screen.getByTestId('cp205-history-draft-approved')).getByText(/Approved · #2/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Approval settings history' })).toHaveTextContent('block → controlled_exception')
  })

  it('present on the reply of the merged 205 on PostgreSQL 17: renders read-only with no button', async () => {
    route({ rpc_get_mfg_cost_policy_205: { data: pg17.reply, error: null } })
    render(<CostPolicyTab />)

    const panel = await screen.findByTestId('cp205-panel')
    expect(within(panel).queryAllByRole('button')).toHaveLength(0)
    for (const v of pg17.reply.versions) expect(screen.getByTestId(`cp205-version-${v.version_no}`)).toBeInTheDocument()
    expect(called()).toEqual(['rpc_get_mfg_cost_policy_205'])
  })

  it('denied: says so, shows no 204 panel and no write', async () => {
    route({ rpc_get_mfg_cost_policy_205: { data: null, error: { code: '42501', message: 'MANUFACTURING_SETTINGS_READ_DENIED' } } })
    render(<CostPolicyTab />)

    expect(await screen.findByTestId('cp205-denied')).toHaveTextContent('You do not have permission')
    expect(screen.queryByTestId('cp-version-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New version' })).not.toBeInTheDocument()
    expect(called()).toEqual(['rpc_get_mfg_cost_policy_205'])
  })

  it.each([
    ['a 5xx', { data: null, error: { code: '', message: 'Internal Server Error' } }],
    ['the absence text without PGRST202', { data: null, error: { code: '', message: 'Could not find the function public.rpc_get_mfg_cost_policy_205' } }],
    ['a malformed reply', { data: cp205Response({ capabilities: {} }), error: null }],
  ])('unknown on %s: error and retry, never the 204 panel or the old form', async (_label, reply) => {
    route({ rpc_get_mfg_cost_policy_205: reply })
    const user = userEvent.setup({ delay: null })
    render(<CostPolicyTab />)

    const alert = await screen.findByTestId('cp205-unknown')
    expect(alert).toHaveTextContent('could not be loaded')
    expect(screen.queryByTestId('cp-version-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New version' })).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(called()).toEqual(['rpc_get_mfg_cost_policy_205', 'rpc_get_mfg_cost_policy_205']))
  })
})

describe('CostPolicyTab: the organization of the reply', () => {
  it('switching the organization without a reload reads the new one, and a late reply of the previous one shows nothing of it', async () => {
    let releaseA!: (reply: unknown) => void
    rpc.mockImplementation((fn: string, args: { p_org_id: string }) => {
      if (fn !== 'rpc_get_mfg_cost_policy_205') throw new Error(`unexpected RPC ${fn}`)
      if (args.p_org_id === ORG) return new Promise(resolve => { releaseA = resolve })
      return Promise.resolve({ data: cp205Response({ org_id: ORG_B, settings: { self_approval_enabled: true, unallocated_budget_policy: 'block' } }), error: null })
    })
    const { rerender } = render(<CostPolicyTab />)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))

    authOrg = ORG_B
    rerender(<CostPolicyTab />)
    expect(await screen.findByTestId('cp205-self-approval')).toHaveTextContent('On')

    // The reply of the first organization arrives after the switch.
    await act(async () => { releaseA({ data: cp205Response(), error: null }) })
    expect(screen.getByTestId('cp205-self-approval')).toHaveTextContent('On')
    expect(screen.getByTestId('cp205-unallocated-policy')).toHaveTextContent('Blocked')
    expect(rpc.mock.calls.map(c => (c[1] as { p_org_id: string }).p_org_id)).toEqual([ORG, ORG_B])
  })

  it('a reply naming another organization is unknown, and neither panel is shown', async () => {
    route({ rpc_get_mfg_cost_policy_205: { data: cp205Response({ org_id: ORG_B }), error: null } })
    render(<CostPolicyTab />)

    expect(await screen.findByTestId('cp205-unknown')).toHaveTextContent('COST_POLICY_205_ORG_MISMATCH')
    expect(screen.queryByTestId('cp205-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cp-version-1')).not.toBeInTheDocument()
  })

  it('no organization selected: reads nothing and shows unknown', async () => {
    authOrg = null
    route({})
    render(<CostPolicyTab />)

    expect(await screen.findByTestId('cp205-unknown')).toHaveTextContent('ORG_UNRESOLVED')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('CostPolicyTab: malformed nested fields end in unknown', () => {
  const v0 = (patch: Record<string, unknown>) => {
    const v = (cp205Response().versions as Record<string, unknown>[])[0]
    return cp205Response({ versions: [{ ...v, ...patch }] })
  }
  const data0 = (cp205Response().versions as Record<string, unknown>[])[0].data_205 as Record<string, unknown>

  it.each([
    ['a null pool in overhead_pools', v0({ overhead_pools: [null] })],
    ['budgets that are an object', v0({ data_205: { ...data0, budgets: {} } })],
    ['an empty approval', v0({ approval: {} })],
  ])('%s: no crash, no 204 panel, no 205 panel', async (_label, reply) => {
    route({ rpc_get_mfg_cost_policy_205: { data: reply, error: null } })
    render(<CostPolicyTab />)

    expect(await screen.findByTestId('cp205-unknown')).toHaveTextContent('COST_POLICY_205_RESPONSE_INVALID')
    expect(screen.queryByTestId('cp205-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cp-version-1')).not.toBeInTheDocument()
    expect(called()).toEqual(['rpc_get_mfg_cost_policy_205'])
  })
})

describe('CostPolicyTab: an old absent result is not shown while discovery runs again', () => {
  it.each([
    ['present', { data: cp205Response(), error: null }, 'cp205-panel'],
    ['denied', { data: null, error: { code: '42501', message: 'MANUFACTURING_SETTINGS_READ_DENIED' } }, 'cp205-denied'],
    ['unknown', { data: null, error: { code: '', message: 'Internal Server Error' } }, 'cp205-unknown'],
  ])('back on the tab with a slow check that ends %s: the 204 panel goes at once and never returns', async (_label, reply, testId) => {
    let pending: Promise<unknown> | null = null
    let release!: (value: unknown) => void
    route({
      rpc_get_mfg_cost_policy_205: () => pending ?? ABSENT,
      rpc_get_mfg_cost_policy: { data: STATE_204, error: null },
    })
    render(<CostPolicyTab />)
    expect(await screen.findByTestId('cp-version-1')).toBeInTheDocument()

    pending = new Promise(resolve => { release = resolve })
    act(() => { focusManager.setFocused(false) })
    act(() => { focusManager.setFocused(true) })

    await waitFor(() => expect(called().filter(fn => fn === 'rpc_get_mfg_cost_policy_205')).toHaveLength(2))
    expect(screen.queryByTestId('cp-version-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New version' })).not.toBeInTheDocument()

    await act(async () => { release(reply) })
    expect(await screen.findByTestId(testId)).toBeInTheDocument()
    expect(screen.queryByTestId('cp-version-1')).not.toBeInTheDocument()
    expect(called().some(fn => WRITES.includes(fn))).toBe(false)
    act(() => { focusManager.setFocused(undefined) })
  })
})
