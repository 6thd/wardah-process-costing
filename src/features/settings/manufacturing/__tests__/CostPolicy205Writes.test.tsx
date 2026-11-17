import { act, fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import { focusManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { cp205Response, ORG, OTHER_USER, SESSION_USER } from '../../../../../tests/fixtures/cost-policy-205'
import { CostPolicyTab } from '../CostPolicyTab'

// The real services run against this client, so every RPC the tab reaches is recorded with its arguments.
const rpc = vi.fn()
let authOrg: string | null = ORG
const GL_ROWS = [{ id: 'gl-9', code: '5900', name: 'Audit fees', name_ar: null }]
let glReply: { data: unknown; error: { message: string } | null } = { data: GL_ROWS, error: null }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ currentOrgId: authOrg }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve(table === 'gl_accounts'
          ? glReply
          : { data: [{ id: 'wc-a', code: 'WC-A', name: 'Mixing', name_ar: null }], error: null }),
      }
      return chain
    },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: SESSION_USER } } } }) },
  },
  getEffectiveTenantId: () => Promise.resolve(authOrg),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

type Reply = { data: unknown; error: { message: string; code?: string } | null }
type Handler = Reply | ((args: Record<string, unknown>) => Reply | Promise<Reply>)
const ok = (data: unknown): Reply => ({ data, error: null })
const refused = (message: string, code = 'P0001'): Reply => ({ data: null, error: { message, code } })
const LOST: Reply = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }

/** One handler per RPC name; a list answers its calls in order and repeats its last entry. */
function route(handlers: Record<string, Handler | Handler[]>) {
  const seen = new Map<string, number>()
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    const h = handlers[fn]
    if (h === undefined) throw new Error(`unexpected RPC ${fn}`)
    const n = seen.get(fn) ?? 0
    seen.set(fn, n + 1)
    const pick = Array.isArray(h) ? h[Math.min(n, h.length - 1)] : h
    return typeof pick === 'function' ? pick(args) : pick
  })
}
const calls = (fn: string) => rpc.mock.calls.filter(c => c[0] === fn).map(c => c[1] as Record<string, unknown>)
const get205 = (overrides: Record<string, unknown> = {}) => ok(cp205Response(overrides))
const drafts = () => cp205Response().drafts as Array<Record<string, unknown>>
const draftsWith = (id: string, patch: Record<string, unknown>) => drafts().map(d => (d.id === id ? { ...d, ...patch } : d))
const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })

beforeEach(async () => {
  rpc.mockReset()
  authOrg = ORG
  glReply = { data: GL_ROWS, error: null }
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  await act(async () => { await i18n.changeLanguage('en') })
})
afterEach(() => { act(() => { focusManager.setFocused(undefined) }) })

async function openPanel() {
  render(<CostPolicyTab />)
  return screen.findByTestId('cp205-panel')
}

describe('new version draft (design §6 and §7)', () => {
  // The two whole-form tests render the full draft form; under coverage they can pass 5s on a loaded machine.
  it('saves a draft prefilled from the latest version, with the exception filled in, one key per content, and no cost center', { timeout: 15000 }, async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_create_mfg_cost_policy_draft_205: [LOST, LOST, ok({ draft_id: 'd9', status: 'draft', revision: 1, replayed: false })] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    expect(within(form).getAllByLabelText('Pool code').map(i => (i as HTMLInputElement).value)).toEqual(['LABOR_OH', 'MACHINE_OH'])
    // SUPERVISION is loaded by no pool and the company allows a controlled exception: reason and treatment are asked.
    expect(within(form).getByTestId('cp205-form-unallocated')).toHaveTextContent('SUPERVISION: 4800.5')
    set(within(form).getByLabelText('Reason for the exception'), 'period cost')
    set(within(form).getByLabelText('Accounting treatment'), 'unabsorbed')
    fireEvent.click(within(form).getByText('Save draft'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/whether the action happened is unknown/)
    const [first] = calls('rpc_create_mfg_cost_policy_draft_205')
    expect(first.p_org_id).toBe(ORG)
    expect(first.p_expected_latest_version_no).toBe(2)
    expect(first.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    const payload = first.p_draft as Record<string, unknown>
    expect(payload.unallocated_exception).toEqual({ budgets: ['SUPERVISION'], reason: 'period cost', treatment: 'unabsorbed' })
    expect((payload.overhead_pools as Array<{ rate: unknown }>)[0].rate).toBe(12)
    expect(JSON.stringify(payload)).not.toMatch(/cost_center/)

    // The same content again after a lost reply carries the same key, so the server replays the same draft.
    fireEvent.click(within(form).getByText('Save draft'))
    await waitFor(() => expect(calls('rpc_create_mfg_cost_policy_draft_205')).toHaveLength(2))
    expect(calls('rpc_create_mfg_cost_policy_draft_205')[1].p_idempotency_key).toBe(first.p_idempotency_key)
    // Changed content gets a new key.
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
    set(within(form).getByLabelText('Note'), 'changed')
    fireEvent.click(within(form).getByText('Save draft'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The draft was saved and awaits a decision.'))
    const third = calls('rpc_create_mfg_cost_policy_draft_205')[2]
    expect(third.p_idempotency_key).not.toBe(first.p_idempotency_key)
    expect(screen.queryByRole('form', { name: 'New cost policy version draft' })).not.toBeInTheDocument()
  })

  it('carries the planned hours of the approved version into the copy, and warns when they cannot be read (Codex P2 on #334)', async () => {
    const approved = { effective_from: '2026-11-10', budgets: [{ budget_code: 'DEPRECIATION', planned_hours: 120 }, { budget_code: 'ELECTRICITY' }] }
    route({
      rpc_get_mfg_cost_policy_205: get205({ drafts: draftsWith('draft-approved', { payload: approved }) }),
      rpc_create_mfg_cost_policy_draft_205: ok({ draft_id: 'd9', status: 'draft', revision: 1, replayed: false }),
    })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    expect(within(form).getAllByLabelText('Planned hours').map(i => (i as HTMLInputElement).value)).toEqual(['120', '', ''])
    // SUPERVISION is in the version but not in the approved draft's budgets: named, not dropped silently.
    expect(within(form).getByTestId('cp205-planned-hours-unknown')).toHaveTextContent('SUPERVISION')
    set(within(form).getByLabelText('Reason for the exception'), 'r')
    set(within(form).getByLabelText('Accounting treatment'), 't')
    fireEvent.submit(form)
    await waitFor(() => expect(calls('rpc_create_mfg_cost_policy_draft_205')).toHaveLength(1))
    const budgets = (calls('rpc_create_mfg_cost_policy_draft_205')[0].p_draft as { budgets: Array<{ budget_code: string; planned_hours?: number }> }).budgets
    expect(budgets.find(b => b.budget_code === 'DEPRECIATION')?.planned_hours).toBe(120)
  })

  it('refuses to send a number it cannot read, and sends nothing', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205() })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    set(within(form).getAllByLabelText('Rate per hour')[0], '1,5')
    fireEvent.submit(form)
    expect(await within(form).findByRole('alert')).toHaveTextContent(/cannot be read/)
    expect(calls('rpc_create_mfg_cost_policy_draft_205')).toHaveLength(0)
  })

  it('adds a budget, loads it on a pool, acknowledges a setup budget on a run pool and shows the early warnings', { timeout: 15000 }, async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_create_mfg_cost_policy_draft_205: ok({ draft_id: 'd9', status: 'draft', revision: 1, replayed: false }) })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    fireEvent.click(within(form).getByText('Add budget'))
    // The accounts load with the form; a value is chosen only once its option exists.
    await waitFor(() => expect(form.querySelector('option[value="gl-9"]')).not.toBeNull())
    const codes = within(form).getAllByLabelText('Budget code')
    set(codes[3], 'setup_crew')
    set(within(form).getAllByLabelText('General ledger account')[3], 'gl-9')
    set(within(form).getAllByLabelText('Amount (SAR)')[3], '3600')
    fireEvent.click(within(within(form).getAllByTestId('cp205-budget-row')[3]).getByRole('checkbox'))
    fireEvent.click(within(form).getByLabelText('MACHINE_OH loads SETUP_CREW'))
    expect(within(form).getByTestId('cp205-warnings')).toHaveTextContent(/explicit acknowledgement\. \(MACHINE_OH\/SETUP_CREW\)/)
    fireEvent.click(within(form).getByLabelText('I acknowledge loading SETUP_CREW on the run pool MACHINE_OH'))
    set(within(form).getByLabelText('Reason for the exception'), 'r')
    set(within(form).getByLabelText('Accounting treatment'), 't')
    fireEvent.click(within(form).getByText('Save draft'))
    await waitFor(() => expect(calls('rpc_create_mfg_cost_policy_draft_205')).toHaveLength(1))
    const payload = calls('rpc_create_mfg_cost_policy_draft_205')[0].p_draft as Record<string, unknown>
    expect(payload.setup_acks).toEqual([{ pool_code: 'MACHINE_OH', budget_code: 'SETUP_CREW' }])
    expect((payload.budgets as unknown[])[3]).toEqual({ budget_code: 'SETUP_CREW', gl_account_id: 'gl-9', setup_related: true, amount: 3600 })
  })

  it('removing or renaming a budget takes its code out of the pools, or moves it (Codex P2 on #334)', { timeout: 15000 }, async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_create_mfg_cost_policy_draft_205: ok({ draft_id: 'd9', status: 'draft', revision: 1, replayed: false }) })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    expect(within(form).getByLabelText('LABOR_OH loads ELECTRICITY')).toBeChecked()
    const rows = within(form).getAllByTestId('cp205-budget-row')
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove' }))
    expect(within(form).queryByLabelText('LABOR_OH loads ELECTRICITY')).not.toBeInTheDocument()
    set(within(form).getAllByLabelText('Budget code')[0], 'depr')
    expect(within(form).getByLabelText('MACHINE_OH loads DEPR')).toBeChecked()
    expect(within(form).getByTestId('cp205-warnings')).not.toHaveTextContent(/refers to a budget that is not in the draft/)
    set(within(form).getByLabelText('Reason for the exception'), 'r')
    set(within(form).getByLabelText('Accounting treatment'), 't')
    fireEvent.submit(form)
    await waitFor(() => expect(calls('rpc_create_mfg_cost_policy_draft_205')).toHaveLength(1))
    const payload = calls('rpc_create_mfg_cost_policy_draft_205')[0].p_draft as { overhead_pools: Array<{ pool_code: string; budgets: string[] }> }
    expect(payload.overhead_pools.map(p => [p.pool_code, p.budgets])).toEqual([['LABOR_OH', []], ['MACHINE_OH', ['DEPR']]])
  })

  it('a pool code change moves the work-center rule with it, and the date starts after the latest version (Codex P2 on #334)', { timeout: 15000 }, async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_create_mfg_cost_policy_draft_205: ok({ draft_id: 'd9', status: 'draft', revision: 1, replayed: false }) })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    // ver-2 starts on 2026-11-10, after today (2026-11-02): the server refuses any date up to it.
    const date = within(form).getByLabelText('Effective from') as HTMLInputElement
    expect(date.value).toBe('2026-11-11')
    expect(date.min).toBe('2026-11-11')
    fireEvent.click(within(form).getByRole('button', { name: 'Add work-center rule' }))
    await within(form).findByRole('option', { name: /WC-A/ })
    set(within(form).getByLabelText('Work center'), 'wc-a')
    set(within(form).getByLabelText('Rule for LABOR_OH'), 'exclude')
    // Typing a new code key by key, through an empty field, keeps the rule.
    const [poolCode] = within(form).getAllByLabelText('Pool code')
    for (const value of ['LABOR_O', '', 'labor']) set(poolCode, value)
    expect(within(form).getByLabelText('Rule for LABOR')).toHaveValue('exclude')
    set(within(form).getByLabelText('Reason for the exception'), 'r')
    set(within(form).getByLabelText('Accounting treatment'), 't')
    fireEvent.submit(form)
    await waitFor(() => expect(calls('rpc_create_mfg_cost_policy_draft_205')).toHaveLength(1))
    const payload = calls('rpc_create_mfg_cost_policy_draft_205')[0].p_draft as Record<string, unknown>
    expect(payload.effective_from).toBe('2026-11-11')
    expect(payload.work_center_rules).toEqual([{ work_center_id: 'wc-a', pools: [{ pool_code: 'LABOR', applies: false }] }])
  })

  it('a work-center rule left with nothing to send is not sent, and the form says so (Codex P2 on #334)', { timeout: 15000 }, async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_create_mfg_cost_policy_draft_205: ok({ draft_id: 'd9', status: 'draft', revision: 1, replayed: false }) })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    fireEvent.click(within(form).getByRole('button', { name: 'Add work-center rule' }))
    await within(form).findByRole('option', { name: /WC-A/ })
    set(within(form).getByLabelText('Work center'), 'wc-a')
    expect(within(form).getByTestId('cp205-rules-empty')).toHaveTextContent('WC-A')
    set(within(form).getByLabelText('Labor rate override'), '40')
    expect(within(form).queryByTestId('cp205-rules-empty')).not.toBeInTheDocument()
    // Recorded entry rates take no labor rate, so the rule has nothing left that the server accepts.
    set(within(form).getByLabelText('Labor cost source'), 'recorded_entry_rate')
    expect(within(form).getByTestId('cp205-rules-empty')).toHaveTextContent(/not sent.*WC-A/)
    set(within(form).getByLabelText('Reason for the exception'), 'r')
    set(within(form).getByLabelText('Accounting treatment'), 't')
    fireEvent.submit(form)
    await waitFor(() => expect(calls('rpc_create_mfg_cost_policy_draft_205')).toHaveLength(1))
    const payload = calls('rpc_create_mfg_cost_policy_draft_205')[0].p_draft as Record<string, unknown>
    expect(payload.labor_cost_source).toBe('recorded_entry_rate')
    expect(payload.work_center_rules).toEqual([])
  })

  it('says so when no account was read for the organization (Kimi P2 on #334)', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205() })
    glReply = { data: [], error: null }
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    expect(await within(form).findByTestId('cp205-accounts-empty')).toHaveTextContent(/No active accounts were read for this organization/)
    expect(within(form).queryByTestId('cp205-accounts-failed')).not.toBeInTheDocument()
  })

  it('says so when the account read fails', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205() })
    glReply = { data: null, error: { message: 'permission denied for table gl_accounts' } }
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New version draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    expect(await within(form).findByTestId('cp205-accounts-failed')).toHaveTextContent(/could not be read/)
    expect(within(form).queryByTestId('cp205-accounts-empty')).not.toBeInTheDocument()
  })

  it('edits my own draft and reports unchanged content without a new revision', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_update_mfg_cost_policy_draft_205: ok({ draft_id: 'draft-stale', status: 'draft', revision: 2, unchanged: true }) })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-stale')).getByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('form', { name: 'Edit version draft' })
    expect((within(form).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-11-20')
    // The stored draft of the fixture is sparse (no labor rate); submit past the browser's required-field check.
    fireEvent.submit(form)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('No changes: the draft is as it was.'))
    expect(calls('rpc_update_mfg_cost_policy_draft_205')[0]).toMatchObject({ p_org_id: ORG, p_draft_id: 'draft-stale', p_expected_latest_version_no: 2 })
  })

  it('copies a rejected draft into a new one, moving a date the server would refuse to the day after the latest version (Codex P2 on #334)', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205() })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-history-draft-rejected')).getByRole('button', { name: 'Copy to a new draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    // 2026-11-05 is not after ver-2 (2026-11-10).
    expect((within(form).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-11-11')
  })

  it('copies a rejected draft keeping a date the server accepts', async () => {
    const rejected = drafts().find(d => d.id === 'draft-rejected') as Record<string, unknown>
    route({ rpc_get_mfg_cost_policy_205: get205({ drafts: draftsWith('draft-rejected', { payload: { ...(rejected.payload as object), effective_from: '2026-11-25' } }) }) })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-history-draft-rejected')).getByRole('button', { name: 'Copy to a new draft' }))
    const form = await screen.findByRole('form', { name: 'New cost policy version draft' })
    expect((within(form).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-11-25')
  })
})

describe('decisions (design §5 and §6)', () => {
  it('approves the revision shown in the review, then reads the state again', async () => {
    route({
      rpc_get_mfg_cost_policy_205: get205(),
      rpc_approve_mfg_cost_policy_draft_205: ok({ draft_id: 'draft-legacy', status: 'approved', policy_version_id: 'ver-3', self_approved: false, unallocated: {}, exception: false }),
    })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' }))
    const review = screen.getByRole('region', { name: 'Review the draft before approval' })
    expect(review).toHaveTextContent('Revision 1 as it was when this review opened')
    fireEvent.click(within(review).getByRole('button', { name: 'Approve revision 1' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The draft was approved and the version written.'))
    expect(calls('rpc_approve_mfg_cost_policy_draft_205')).toEqual([{ p_org_id: ORG, p_draft_id: 'draft-legacy', p_expected_revision: 1 }])
    expect(calls('rpc_get_mfg_cost_policy_205').length).toBeGreaterThan(1)
  })

  it('shows the work-center rules, pool bases, pin timing, planned hours and setup acknowledgements in the review (Codex P2 on #334)', async () => {
    const payload = {
      effective_from: '2026-11-20', labor_cost_source: 'work_center_rate', default_labor_rate_per_hour: 30, pin_event: 'production_started',
      overhead_pools: [
        { pool_code: 'LABOR_OH', basis: 'labor_hours', rate: 12, activity: 'run', budgets: ['SETUP_CREW'] },
        { pool_code: 'MACHINE_OH', basis: 'machine_hours', rate: 46, activity: 'both', budgets: [] },
      ],
      budgets: [{ budget_code: 'SETUP_CREW', gl_account_id: 'gl-1', setup_related: true, amount: 3600, planned_hours: 60 }],
      setup_acks: [{ pool_code: 'LABOR_OH', budget_code: 'SETUP_CREW' }],
      work_center_rules: [
        { work_center_id: 'wc-a', labor_rate_per_hour: 40, pools: [{ pool_code: 'LABOR_OH', applies: true, rate: 15 }] },
        { work_center_id: 'wc-gone', pools: [{ pool_code: 'LABOR_OH', applies: false }] },
      ],
    }
    route({ rpc_get_mfg_cost_policy_205: get205({ drafts: draftsWith('draft-legacy', { kind: 'version', legacy_version_id: null, expected_latest_version_no: 2, payload }) }) })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' }))
    const review = screen.getByRole('region', { name: 'Review the draft before approval' })
    const summary = within(review).getByTestId('cp205-summary-draft-legacy')
    expect(summary).toHaveTextContent('Pin timing: When production first starts')
    // The basis picks the labor or machine hours in the server computation; a change of basis alone must show.
    expect(summary).toHaveTextContent('LABOR_OH · Labor hours · 12 / hour · run · loads: SETUP_CREW')
    expect(summary).toHaveTextContent('MACHINE_OH · Machine hours · 46 / hour')
    expect(summary).toHaveTextContent('SETUP_CREW: 3600 · Setup related · Planned hours: 60')
    expect(summary).toHaveTextContent('Setup budgets acknowledged on run pools: LABOR_OH/SETUP_CREW')
    const rules = within(summary).getByTestId('cp205-summary-rules')
    // The work-center code once the list is read; the id when the work center is not in it.
    await waitFor(() => expect(rules).toHaveTextContent('WC-A: Labor rate override: 40 / hour · LABOR_OH: Own rate 15 / hour'))
    expect(rules).toHaveTextContent('wc-gone: LABOR_OH: Excluded here')
  })

  it('says when a version draft has no work-center rule', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205({ drafts: draftsWith('draft-legacy', { kind: 'version', legacy_version_id: null, expected_latest_version_no: 2, payload: { effective_from: '2026-11-20' } }) }) })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' }))
    const review = screen.getByRole('region', { name: 'Review the draft before approval' })
    expect(within(review).getByTestId('cp205-summary-rules')).toHaveTextContent('Work-center rules: none; every work center uses the default labor rate')
  })

  it('keeps the review frozen when a newer revision arrives, and disables the approval', async () => {
    route({ rpc_get_mfg_cost_policy_205: [get205(), get205({ drafts: draftsWith('draft-legacy', { revision: 2 }) })] })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' }))
    act(() => { focusManager.setFocused(true) })
    const review = screen.getByRole('region', { name: 'Review the draft before approval' })
    expect(await within(review).findByRole('alert')).toHaveTextContent(/A newer revision/)
    expect(review).toHaveTextContent('Revision 1 as it was when this review opened')
    expect(within(review).getByRole('button', { name: 'Approve revision 1' })).toBeDisabled()
    // No check is sent for a revision that is no longer the pending one (Kimi P3 on #334).
    expect(within(review).getByRole('button', { name: 'Check this revision' })).toBeDisabled()
  })

  it('after a lost reply reads first, and shows success only for this draft approved at this revision by this session', async () => {
    route({
      rpc_get_mfg_cost_policy_205: [get205(), get205({ drafts: draftsWith('draft-legacy', { status: 'approved', decided_by: SESSION_USER, result_version_id: 'ver-2' }) })],
      rpc_approve_mfg_cost_policy_draft_205: LOST,
    })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve revision 1' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The draft was approved and the version written.'))
    expect(calls('rpc_approve_mfg_cost_policy_draft_205')).toHaveLength(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('on a revision conflict does not send again, and shows the translated refusal', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_approve_mfg_cost_policy_draft_205: refused('COST_POLICY_DRAFT_REVISION_CONFLICT: current=2') })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve revision 1' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/edited after you opened it.*\(current=2\)/)))
    expect(calls('rpc_approve_mfg_cost_policy_draft_205')).toHaveLength(1)
    // A lost reply of another approver's decision is not shown as this session's success.
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a stale draft cannot be approved; its creator updates the base to the latest version', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_update_mfg_cost_policy_draft_205: ok({ draft_id: 'draft-stale', status: 'draft', revision: 3, unchanged: false }) })
    await openPanel()
    const actions = screen.getByTestId('cp205-actions-draft-stale')
    fireEvent.click(within(actions).getByRole('button', { name: 'Review and approve' }))
    expect(within(actions).getByRole('button', { name: 'Approve revision 2' })).toBeDisabled()
    expect(within(actions).getByText(/the approval will refuse it/)).toBeInTheDocument()
    fireEvent.click(within(actions).getByRole('button', { name: 'Update base to version 2' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The draft base was updated and its revision raised.'))
    expect(calls('rpc_update_mfg_cost_policy_draft_205')[0]).toEqual({
      p_org_id: ORG, p_draft_id: 'draft-stale', p_draft: drafts()[0].payload, p_expected_latest_version_no: 2,
    })
  })

  it('rejects with a reason and withdraws my own draft with a reason', async () => {
    route({
      rpc_get_mfg_cost_policy_205: get205(),
      rpc_reject_mfg_cost_policy_draft_205: ok({ draft_id: 'draft-legacy', status: 'rejected' }),
      rpc_withdraw_mfg_cost_policy_draft_205: ok({ draft_id: 'draft-stale', status: 'withdrawn' }),
    })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Reject' }))
    const reject = screen.getByTestId('cp205-reject-draft-legacy')
    expect(within(reject).getByRole('button', { name: 'Confirm rejection' })).toBeDisabled()
    set(within(reject).getByLabelText('Reason for rejection'), '  pools not agreed ')
    fireEvent.click(within(reject).getByRole('button', { name: 'Confirm rejection' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The draft was rejected.'))
    expect(calls('rpc_reject_mfg_cost_policy_draft_205')).toEqual([{ p_org_id: ORG, p_draft_id: 'draft-legacy', p_reason: 'pools not agreed' }])

    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-stale')).getByRole('button', { name: 'Withdraw draft' }))
    set(screen.getByLabelText('Reason for withdrawing the draft'), 'replaced')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The draft was withdrawn.'))
    expect(calls('rpc_withdraw_mfg_cost_policy_draft_205')).toEqual([{ p_org_id: ORG, p_draft_id: 'draft-stale', p_reason: 'replaced' }])
  })

  it('a refusal of permission reads the state again and shows the reason', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_reject_mfg_cost_policy_draft_205: refused('COST_POLICY_APPROVE_DENIED', '42501') })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Reject' }))
    set(screen.getByLabelText('Reason for rejection'), 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Approving or rejecting drafts requires the cost policy approval permission.'))
    expect(calls('rpc_get_mfg_cost_policy_205').length).toBeGreaterThan(1)
  })

  it('without self-approval the creator sees no approval button for their own draft', async () => {
    const caps = { can_create: true, can_approve: true, can_self_approve: false, can_manage_approval_settings: false, can_manage_unallocated_policy: false }
    route({ rpc_get_mfg_cost_policy_205: get205({ capabilities: caps }) })
    await openPanel()
    const mine = screen.getByTestId('cp205-actions-draft-stale')
    expect(within(mine).queryByRole('button', { name: 'Review and approve' })).not.toBeInTheDocument()
    expect(within(mine).getByText(/cannot approve your own draft/)).toBeInTheDocument()
    expect(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' })).toBeInTheDocument()
  })
})

describe('draft check (design §17)', () => {
  const checkReply = (args: Record<string, unknown>) => ok({
    draft_id: args.p_draft_id, kind: 'legacy_resolution', revision: args.p_expected_revision, latest_version_no: 2,
    policy_at_check: { self_approval_enabled: false, unallocated_budget_policy: 'controlled_exception' },
    valid: args.p_work_center_id === undefined,
    refusal: args.p_work_center_id === undefined ? null : { code: 'COST_POLICY_POOL_WITHOUT_BUDGET', detail: 'MACHINE_OH' },
    unallocated: [{ budget_code: 'SUPERVISION', amount: 4800.5 }], preview: null, preview_refusal: null, checked_at: '2026-11-02T10:00:00Z',
  })

  it('checks the revision on screen, says it is no approval, and expires when an input changes', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_check_mfg_cost_policy_draft_205: checkReply })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Review and approve' }))
    const check = screen.getByTestId('cp205-check-draft-legacy')
    fireEvent.click(within(check).getByRole('button', { name: 'Check this revision' }))
    const result = await within(check).findByTestId('cp205-check-result-draft-legacy')
    expect(result).toHaveTextContent('Revision 1 is valid at check time.')
    expect(result).toHaveTextContent(/the approval checks everything again/)
    expect(result).toHaveTextContent('SUPERVISION: 4800.50 SAR')
    expect(calls('rpc_check_mfg_cost_policy_draft_205')).toEqual([{ p_org_id: ORG, p_draft_id: 'draft-legacy', p_expected_revision: 1 }])

    set(within(check).getByLabelText('Work center'), 'wc-a')
    expect(within(check).queryByTestId('cp205-check-result-draft-legacy')).not.toBeInTheDocument()
    expect(within(check).getByRole('status')).toHaveTextContent(/The check has expired/)
    fireEvent.click(within(check).getByRole('button', { name: 'Check this revision' }))
    expect(await within(check).findByRole('alert')).toHaveTextContent('The approval will refuse it: The pool loads no budget. (MACHINE_OH)')
    expect(calls('rpc_check_mfg_cost_policy_draft_205')[1]).toMatchObject({ p_work_center_id: 'wc-a', p_hours: {} })
  })
})

describe('approval settings (design §8)', () => {
  it('turns self-approval on with a reason and shows the effect first', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_set_cost_policy_self_approval_205: ok({ self_approval_enabled: true, unallocated_budget_policy: 'controlled_exception' }) })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Turn self-approval on' }))
    expect(screen.getByText(/can approve their own draft/)).toBeInTheDocument()
    set(screen.getByLabelText('Reason for the change'), 'small team')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The setting changed; it applies to later approvals only.'))
    expect(calls('rpc_set_cost_policy_self_approval_205')).toEqual([{ p_org_id: ORG, p_enabled: true, p_reason: 'small team' }])
  })

  it('treats "unchanged" as success only after a read confirms the value', async () => {
    route({
      rpc_get_mfg_cost_policy_205: [get205(), get205({ settings: { self_approval_enabled: false, unallocated_budget_policy: 'block' } })],
      rpc_set_cost_policy_unallocated_policy_205: refused('COST_POLICY_SETTING_UNCHANGED', '22023'),
    })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Change the policy to: Blocked at approval' }))
    expect(screen.getByText(/including drafts pending now/)).toBeInTheDocument()
    set(screen.getByLabelText('Reason for the change'), 'tighten')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The setting changed; it applies to later approvals only.'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows "unchanged" as a refusal when the read does not confirm the value', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_set_cost_policy_unallocated_policy_205: refused('COST_POLICY_SETTING_UNCHANGED', '22023') })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Change the policy to: Blocked at approval' }))
    set(screen.getByLabelText('Reason for the change'), 'tighten')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The setting already has this value.'))
  })
})

describe('legacy resolution (design §9)', () => {
  it('starts a resolution for an unresolved version with its pools, budgets and a reason', async () => {
    const noResolution = drafts().filter(d => d.id !== 'draft-legacy')
    route({ rpc_get_mfg_cost_policy_205: get205({ drafts: noResolution }), rpc_create_legacy_resolution_draft_205: ok({ draft_id: 'd7', status: 'draft', revision: 1, replayed: false }) })
    await openPanel()
    fireEvent.click(within(screen.getByTestId('cp205-legacy-1')).getByRole('button', { name: 'Start resolution' }))
    const form = await screen.findByRole('form', { name: 'Resolution of legacy version 1' })
    fireEvent.click(within(form).getByRole('button', { name: 'Add budget' }))
    set(within(form).getByLabelText('Budget code'), 'ELEC')
    set(within(form).getByLabelText('Amount (SAR)'), '9000')
    set(within(form).getByLabelText('Activity of LABOR_OH'), 'both')
    fireEvent.click(within(form).getByLabelText('LABOR_OH loads ELEC'))
    // A rename moves the pool reference with the budget (Codex P2 on #334).
    set(within(form).getByLabelText('Budget code'), 'power')
    expect(within(form).getByLabelText('LABOR_OH loads POWER')).toBeChecked()
    expect(within(form).getByRole('button', { name: 'Save resolution draft' })).toBeDisabled()
    set(within(form).getByLabelText('Reason for the resolution'), 'resolve v1')
    fireEvent.click(within(form).getByRole('button', { name: 'Save resolution draft' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The draft was saved and awaits a decision.'))
    const [args] = calls('rpc_create_legacy_resolution_draft_205')
    expect(args).toMatchObject({ p_org_id: ORG, p_policy_version_id: 'ver-1', p_reason: 'resolve v1' })
    expect(args.p_resolution).toEqual({
      pools: [{ pool_code: 'LABOR_OH', activity: 'both', budgets: ['POWER'] }, { pool_code: 'MACHINE_OH', budgets: [] }],
      budgets: [{ budget_code: 'POWER', setup_related: false, amount: 9000 }],
      setup_acks: [],
    })
  })
})

describe('205 preview of a stored version (design §10 and §11)', () => {
  const PREVIEW = {
    labor: { source: 'work_center_rate', amount: 300 },
    overhead: [{ pool_code: 'LABOR_OH', basis: 'labor_hours', activity: 'both', amount: 120 }],
    excluded_pools: ['MACHINE_OH'], overhead_total: 120, total: 420,
    unallocated_budgets: [{ budget_code: 'SUPERVISION', amount: 4800.5 }], cents: { labor: 30000, pools: { LABOR_OH: 12000 }, total: 42000 },
  }

  it('refuses a legacy version, sends only measured hours, keeps unloaded budgets outside the total, and hides the result on change', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_preview_mfg_cost_absorption_205: ok(PREVIEW) })
    await openPanel()
    const version = screen.getByLabelText('Version') as HTMLSelectElement
    expect([...version.options].find(o => o.value === 'ver-1')?.disabled).toBe(true)
    set(version, 'ver-2')
    await screen.findByRole('option', { name: 'WC-A — Mixing' })
    set(screen.getByLabelText('Work center', { selector: '#cp205-preview-wc' }), 'wc-a')
    set(screen.getByLabelText('Labor hours (run)', { selector: '#cp205-preview-laborRun' }), '10')
    set(screen.getByLabelText('Machine hours (setup)', { selector: '#cp205-preview-machineSetup' }), '0')
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    const result = await screen.findByTestId('cp205-preview-result')
    expect(result).toHaveTextContent('Total: 420.00 SAR')
    expect(within(result).getByTestId('cp205-preview-result-unallocated')).toHaveTextContent('SUPERVISION: 4800.50 SAR')
    expect(calls('rpc_preview_mfg_cost_absorption_205')).toEqual([{
      p_org_id: ORG, p_policy_version_id: 'ver-2', p_work_center_id: 'wc-a', p_hours: { labor: { run: 10 }, machine: { setup: 0 } },
    }])
    expect(rpc.mock.calls.some(c => c[0] === 'rpc_preview_mfg_cost_absorption')).toBe(false)
    set(screen.getByLabelText('Labor hours (run)', { selector: '#cp205-preview-laborRun' }), '11')
    expect(screen.queryByTestId('cp205-preview-result')).not.toBeInTheDocument()
  })

  it('shows a refusal of the preview translated', async () => {
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_preview_mfg_cost_absorption_205: refused('COST_POLICY_DRIVER_MISSING: labor.setup', '22023') })
    await openPanel()
    set(screen.getByLabelText('Version'), 'ver-2')
    await screen.findByRole('option', { name: 'WC-A — Mixing' })
    set(screen.getByLabelText('Work center', { selector: '#cp205-preview-wc' }), 'wc-a')
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(await screen.findByText(/A required driver was not entered.*\(labor\.setup\)/)).toBeInTheDocument()
  })
})

describe('version withdrawal through the 204 path (design §16, owner decision Q-4)', () => {
  it('withdraws a scheduled version with no orders, for the organization of the panel', async () => {
    const reply204 = { org_id: ORG, today: '2026-11-02', current_version_id: 'ver-1', latest_version_no: 2, versions: [], supported: {}, capabilities: { can_manage: true } }
    route({ rpc_get_mfg_cost_policy_205: get205(), rpc_withdraw_mfg_cost_policy_version: ok(reply204) })
    await openPanel()
    expect(within(screen.getByTestId('cp205-version-1')).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('cp205-version-2')).getByRole('button', { name: 'Withdraw' }))
    expect(screen.getByText('The version number is not reused after withdrawal.')).toBeInTheDocument()
    set(screen.getByLabelText('Reason for withdrawal'), 'wrong rates')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Version withdrawn'))
    expect(calls('rpc_withdraw_mfg_cost_policy_version')).toEqual([{ p_org_id: ORG, p_policy_version_id: 'ver-2', p_reason: 'wrong rates' }])
  })
})

describe('organization of a late reply', () => {
  it('a reply that arrives after the organization changed shows nothing', async () => {
    let release: (r: Reply) => void = () => undefined
    const ORG_B = '52050205-0000-0000-0000-0000000000b1'
    route({
      rpc_get_mfg_cost_policy_205: (args) => ok(cp205Response({ org_id: args.p_org_id })),
      rpc_reject_mfg_cost_policy_draft_205: () => new Promise<Reply>(r => { release = r }),
    })
    const view = render(<CostPolicyTab />)
    await screen.findByTestId('cp205-panel')
    fireEvent.click(within(screen.getByTestId('cp205-actions-draft-legacy')).getByRole('button', { name: 'Reject' }))
    set(screen.getByLabelText('Reason for rejection'), 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))
    await waitFor(() => expect(calls('rpc_reject_mfg_cost_policy_draft_205')).toHaveLength(1))
    authOrg = ORG_B
    view.rerender(<CostPolicyTab />)
    await waitFor(() => expect(calls('rpc_get_mfg_cost_policy_205').some(a => a.p_org_id === ORG_B)).toBe(true))
    await act(async () => { release(ok({ draft_id: 'draft-legacy', status: 'rejected' })) })
    await waitFor(() => expect(calls('rpc_get_mfg_cost_policy_205').filter(a => a.p_org_id === ORG).length).toBeGreaterThanOrEqual(1))
    expect(toast.success).not.toHaveBeenCalled()
    expect(OTHER_USER).not.toBe(SESSION_USER)
  })
})
