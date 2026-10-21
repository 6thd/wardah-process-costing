import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
const fixture = vi.hoisted(() => ({
  user: 'ed000000-0000-4000-8000-0000000000a2', org: 'ed000000-0000-4000-8000-000000000001',
  mo: 'ed000000-0000-4000-8000-000000000010', stage: 'ed000000-0000-4000-8000-0000000000f1',
  wo: 'ed000000-0000-4000-8000-000000000020', reservation: 'ed000000-0000-4000-8000-000000000030',
  item: 'ed000000-0000-4000-8000-0000000000d1', product: 'ed000000-0000-4000-8000-0000000000c1',
  warehouse: 'ed000000-0000-4000-8000-0000000000e1', uom: 'ed000000-0000-4000-8000-000000000040',
  admin: false, grant: true, loading: false, permissionError: null as Error | null, identity: '', authLoading: false,
}))
const rpc = vi.hoisted(() => vi.fn())
const getUser = vi.hoisted(() => vi.fn())
const invalidate = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, auth: { getUser } } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: fixture.user }, currentOrgId: fixture.org, loading: fixture.authLoading }) }))
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({
  hasPermissionKey: (key: string) => fixture.grant && key === 'manufacturing.material_consumption.consume',
  loading: fixture.loading, error: fixture.permissionError, isOrgAdmin: fixture.admin, permissionIdentityKey: fixture.identity,
}) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
function translate(key: string) { return key }
import { MaterialIssuePage } from '../material-issue/MaterialIssuePage'
import { MaterialIssuePolicyPage } from '../material-issue/MaterialIssuePolicyPage'
import { claimMaterialIssue, pendingMaterialIssue, sendMaterialIssue } from '@/services/manufacturing/materialIssueClient'
import { getIssueContext, getIssueOrders, issueCommand, type IssueContext } from '@/services/manufacturing/materialIssueOptions'
function context(): IssueContext {
  return { org_id: fixture.org, mo_id: fixture.mo, stages: [{ id: fixture.stage, label: 'Stage 1' }], work_orders: [{ id: fixture.wo, label: 'WO-1' }],
    reservations: [{ id: fixture.reservation, label: 'Raw', item_id: fixture.item, product_id: fixture.product, uom_id: fixture.uom, uom_label: 'KG', remaining: 100 }],
    warehouses: [{ id: fixture.warehouse, label: 'Warehouse 1', product_ids: [fixture.product] }] }
}
function command() { return { orgId: fixture.org, userId: fixture.user, moId: fixture.mo, stageId: fixture.stage,
  lines: [{ item_id: fixture.item, reservation_id: fixture.reservation, warehouse_id: fixture.warehouse, work_order_id: fixture.wo,
    uom_id: fixture.uom, quantity: 10, consumption_type: 'MANUAL' as const, notes: null }] } }
function policy(version = 1, statuses = ['IN_PROGRESS']) { return { org_id: fixture.org, version, allowed_statuses: statuses } }
function success(args: Record<string, unknown>) { return { success: true, org_id: fixture.org, mo_id: fixture.mo,
  stage_id: fixture.stage, event_id: args.p_event_id, consumption_count: 1, consumption_ids: [fixture.reservation], material_cost_posted: 100 } }
function defaultRpc(name: string, args: Record<string, unknown>) {
  if (name === 'rpc_list_material_issue_orders') return { data: { org_id: fixture.org, orders: [{ id: fixture.mo, org_id: fixture.org, label: 'MO-1' }] }, error: null }
  if (name === 'rpc_get_material_issue_context') return { data: context(), error: null }
  if (name === 'rpc_get_material_issue_wo_statuses') return { data: policy(), error: null }
  if (name === 'rpc_set_material_issue_wo_statuses') return { data: policy(2, args.p_allowed_statuses as string[]), error: null }
  return { data: success(args), error: null }
}
async function selectMO() {
  const user = userEvent.setup(); await screen.findByText('MO-1')
  await user.selectOptions(screen.getByLabelText('materialIssue.mo'), fixture.mo)
  await screen.findByText('materialIssue.policyVersion', { exact: false }); return user
}
async function completeForm() {
  const user = await selectMO()
  await waitFor(() => expect(screen.getByLabelText('materialIssue.reservation 1')).toBeEnabled())
  await user.selectOptions(screen.getByLabelText('materialIssue.stage'), fixture.stage)
  await user.selectOptions(screen.getByLabelText('materialIssue.reservation 1'), fixture.reservation)
  await user.selectOptions(screen.getByLabelText('materialIssue.wo 1'), fixture.wo)
  await user.selectOptions(screen.getByLabelText('materialIssue.warehouse 1'), fixture.warehouse)
  await user.selectOptions(screen.getByLabelText('materialIssue.uom 1'), fixture.uom)
  await user.type(screen.getByLabelText('materialIssue.quantity 1'), '10'); return user
}
beforeEach(() => {
  vi.unstubAllEnvs(); vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  vi.stubGlobal('indexedDB', new IDBFactory())
  fixture.org = 'ed000000-0000-4000-8000-000000000001'; fixture.user = 'ed000000-0000-4000-8000-0000000000a2'
  fixture.identity = `${fixture.user}:${fixture.org}`; fixture.admin = false; fixture.grant = true
  fixture.loading = false; fixture.permissionError = null; fixture.authLoading = false
  rpc.mockReset().mockImplementation(defaultRpc); invalidate.mockClear()
  getUser.mockReset().mockImplementation(async () => ({ data: { user: { id: fixture.user } }, error: null }))
})
describe('employee issue UI with durable client', () => {
  it('hard-blocks production even with the isolated flag', () => {
    vi.stubEnv('PROD', true); render(<MaterialIssuePage />)
    expect(screen.getByText('materialIssue.hold')).toBeInTheDocument(); expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['grant', 'loading', 'error', 'identity'])('does not read options when %s gate fails', kind => {
    if (kind === 'grant') fixture.grant = false
    if (kind === 'loading') fixture.loading = true
    if (kind === 'error') fixture.permissionError = new Error('failed')
    if (kind === 'identity') fixture.identity = 'old:user'
    render(<MaterialIssuePage />); expect(rpc).not.toHaveBeenCalled()
  })
  it('requires every selector, sends only canonical fields and invalidates only after acknowledgement', async () => {
    render(<MaterialIssuePage />); const user = await completeForm(); expect(invalidate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'materialIssue.submit' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'materialIssue.submit' }))
    await screen.findByText('materialIssue.succeeded', { exact: false })
    const [, args] = rpc.mock.calls.find(([name]) => name === 'rpc_consume_material_event')!
    expect(args.p_consumptions).toEqual(command().lines); expect(args.p_event_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(await pendingMaterialIssue(fixture.user, fixture.mo)).toBeNull(); expect(invalidate).toHaveBeenCalledOnce()
  })
  it('blocks a new issue after a partial selector read fails', async () => {
    rpc.mockImplementation((name, args) => name === 'rpc_get_material_issue_context' ? { data: { ...context(), warehouses: null }, error: null } : defaultRpc(name, args))
    render(<MaterialIssuePage />); const user = userEvent.setup(); await screen.findByText('MO-1')
    await user.selectOptions(screen.getByLabelText('materialIssue.mo'), fixture.mo); await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'materialIssue.submit' })).toBeDisabled()
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_consume_material_event')).toBe(false)
  })
  it('recovers a lost response after unmount and retries the exact event and payload', async () => {
    let lost = true
    rpc.mockImplementation((name, args) => { if (name === 'rpc_consume_material_event' && lost) { lost = false; throw new Error('lost response') }; return defaultRpc(name, args) })
    const first = render(<MaterialIssuePage />); const user = await completeForm()
    await user.click(screen.getByRole('button', { name: 'materialIssue.submit' }))
    await screen.findByRole('button', { name: 'materialIssue.retry' }); expect(invalidate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'materialIssue.acknowledge' })).not.toBeInTheDocument()
    first.unmount(); render(<MaterialIssuePage />); await selectMO()
    await user.click(await screen.findByRole('button', { name: 'materialIssue.retry' }))
    await screen.findByText('materialIssue.succeeded', { exact: false })
    const calls = rpc.mock.calls.filter(([name]) => name === 'rpc_consume_material_event')
    expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual(calls[1][1])
  })
  it('can recover a saved event even when selectors for a new event cannot be read', async () => {
    const saved = await claimMaterialIssue(command())
    rpc.mockImplementation((name, args) => name === 'rpc_get_material_issue_context' ? { data: null, error: { code: 'P0001', message: 'MO_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE' } } : defaultRpc(name, args))
    render(<MaterialIssuePage />); const user = userEvent.setup(); await screen.findByText('MO-1')
    await user.selectOptions(screen.getByLabelText('materialIssue.mo'), fixture.mo)
    await screen.findByText(saved.eventId)
    await user.click(screen.getByRole('button', { name: 'materialIssue.retry' }))
    await screen.findByText('materialIssue.succeeded', { exact: false })
  })
  it('recovers another tab claim without sending a second event', async () => {
    render(<MaterialIssuePage />); const user = await completeForm(); const saved = await claimMaterialIssue(command())
    await user.click(screen.getByRole('button', { name: 'materialIssue.submit' })); await screen.findByText(saved.eventId)
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_consume_material_event')).toBe(false)
  })
  it('allows acknowledgement of an exclusively definite rejection', async () => {
    rpc.mockImplementation((name, args) => name === 'rpc_consume_material_event' ? { data: null, error: { code: 'P0001', message: 'MATERIAL_CONSUMPTION_PERMISSION_DENIED' } } : defaultRpc(name, args))
    render(<MaterialIssuePage />); const user = await completeForm(); await user.click(screen.getByRole('button', { name: 'materialIssue.submit' }))
    await user.click(await screen.findByRole('button', { name: 'materialIssue.acknowledge' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'materialIssue.retry' })).not.toBeInTheDocument())
  })
  it('keeps an unknown attempt after a later definite rejection', async () => {
    const saved = await claimMaterialIssue(command())
    rpc.mockImplementation((name, args) => name === 'rpc_consume_material_event' ? { data: null, error: { code: 'P0001', message: 'MATERIAL_CONSUMPTION_PERMISSION_DENIED' } } : defaultRpc(name, args))
    rpc.mockImplementationOnce(() => { throw new Error('lost') }); await expect(sendMaterialIssue(saved.eventId)).rejects.toThrow('lost')
    render(<MaterialIssuePage />); const user = await selectMO(); await user.click(await screen.findByRole('button', { name: 'materialIssue.retry' }))
    await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'materialIssue.acknowledge' })).not.toBeInTheDocument()
  })
  it('never sends after durable storage fails', async () => {
    vi.stubGlobal('indexedDB', undefined); render(<MaterialIssuePage />); await selectMO(); await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'materialIssue.submit' })).toBeDisabled()
  })
  it('clears the form immediately after permission revocation', async () => {
    const page = render(<MaterialIssuePage />); await completeForm(); fixture.grant = false; page.rerender(<MaterialIssuePage />)
    expect(screen.queryByLabelText('materialIssue.quantity 1')).not.toBeInTheDocument()
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_consume_material_event')).toBe(false)
  })
  it('discards old-organization selectors on identity change', async () => {
    const page = render(<MaterialIssuePage />); await completeForm(); fixture.org = 'ed000000-0000-4000-8000-000000000002'; fixture.identity = `${fixture.user}:${fixture.org}`
    page.rerender(<MaterialIssuePage />); expect(screen.queryByLabelText('materialIssue.quantity 1')).not.toBeInTheDocument()
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_consume_material_event')).toBe(false)
  })
  it('does not send after switching identity while verification is pending', async () => {
    let finish!: (value: unknown) => void
    const page = render(<MaterialIssuePage />); const user = await completeForm()
    getUser.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await user.click(screen.getByRole('button', { name: 'materialIssue.submit' }))
    fixture.user = 'ed000000-0000-4000-8000-0000000000a3'; fixture.identity = `${fixture.user}:${fixture.org}`
    page.rerender(<MaterialIssuePage />); finish({ data: { user: { id: command().userId } }, error: null })
    await waitFor(() => expect(screen.queryByLabelText('materialIssue.quantity 1')).not.toBeInTheDocument())
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_consume_material_event')).toBe(false)
  })
  it('invalidates edited selectors on focus', async () => {
    render(<MaterialIssuePage />); await completeForm(); fireEvent.focus(window)
    await waitFor(() => expect(screen.getByLabelText('materialIssue.stage')).toHaveValue(''))
    expect(screen.getByRole('button', { name: 'materialIssue.submit' })).toBeDisabled()
  })
})
describe('Org Admin policy UI', () => {
  it('shows read-only settings to an employee', async () => {
    render(<MaterialIssuePolicyPage />); await screen.findByText('materialIssue.policyVersion', { exact: false })
    expect(screen.getByRole('checkbox', { name: 'READY' })).toBeDisabled(); expect(screen.queryByRole('button', { name: 'materialIssue.save' })).not.toBeInTheDocument()
  })
  it('disables saving after a failed read without writing defaults', async () => {
    fixture.admin = true; rpc.mockRejectedValue(new Error('unavailable')); render(<MaterialIssuePolicyPage />); await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'materialIssue.save' })).toBeDisabled(); expect(rpc.mock.calls.some(([name]) => name === 'rpc_set_material_issue_wo_statuses')).toBe(false)
  })
  it('saves canonical statuses and reloads the latest server version', async () => {
    fixture.admin = true; let saved = false
    rpc.mockImplementation((name, args) => { if (name === 'rpc_set_material_issue_wo_statuses') saved = true
      if (name === 'rpc_get_material_issue_wo_statuses' && saved) return { data: policy(3, ['IN_PROGRESS', 'IN_SETUP']), error: null }; return defaultRpc(name, args) })
    render(<MaterialIssuePolicyPage />); const user = userEvent.setup(); await screen.findByText('materialIssue.policyVersion', { exact: false })
    await user.click(screen.getByRole('checkbox', { name: 'READY' })); await user.click(screen.getByRole('button', { name: 'materialIssue.save' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'IN_SETUP' })).toBeChecked()); expect(screen.getByRole('checkbox', { name: 'READY' })).not.toBeChecked()
    expect(rpc).toHaveBeenCalledWith('rpc_set_material_issue_wo_statuses', { p_org_id: fixture.org, p_allowed_statuses: ['IN_PROGRESS', 'READY'] })
    expect(screen.getByText('materialIssue.policyVersion: 3')).toBeInTheDocument()
  })
  it('requires a reload after an uncertain save', async () => {
    fixture.admin = true; rpc.mockImplementation((name, args) => { if (name === 'rpc_set_material_issue_wo_statuses') throw new Error('lost'); return defaultRpc(name, args) })
    render(<MaterialIssuePolicyPage />); const user = userEvent.setup(); await screen.findByText('materialIssue.policyVersion', { exact: false })
    await user.click(screen.getByRole('button', { name: 'materialIssue.save' })); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'materialIssue.save' })).toBeDisabled()
  })
  it('removes edit authority after revocation while the form is open', async () => {
    fixture.admin = true; const page = render(<MaterialIssuePolicyPage />); await screen.findByText('materialIssue.policyVersion', { exact: false })
    fixture.admin = false; page.rerender(<MaterialIssuePolicyPage />); expect(screen.queryByRole('button', { name: 'materialIssue.save' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'READY' })).toBeDisabled()
  })
  it('does not write when authority is revoked during identity verification', async () => {
    fixture.admin = true; let finish!: (value: unknown) => void
    getUser.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const page = render(<MaterialIssuePolicyPage />); await screen.findByText('materialIssue.policyVersion', { exact: false })
    await userEvent.setup().click(screen.getByRole('button', { name: 'materialIssue.save' }))
    fixture.admin = false; page.rerender(<MaterialIssuePolicyPage />); finish({ data: { user: { id: fixture.user } }, error: null })
    await waitFor(() => expect(screen.getByRole('button', { name: 'materialIssue.refresh' })).toBeEnabled())
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_set_material_issue_wo_statuses')).toBe(false)
  })
})
describe('selection validation before claim', () => {
  const draft = () => ({ reservation: fixture.reservation, warehouse: fixture.warehouse, workOrder: fixture.wo, uom: fixture.uom, quantity: '10', notes: '' })
  it.each(['0','-1','1.0000001','1e2','Infinity','101'])('rejects quantity %s', quantity => { expect(() => issueCommand(context(), fixture.user, fixture.stage, [{ ...draft(), quantity }])).toThrow() })
  it('rejects duplicate reservations and cross-product warehouses', () => {
    expect(() => issueCommand(context(), fixture.user, fixture.stage, [draft(), draft()])).toThrow()
    const rows = context(); rows.warehouses[0].product_ids = [fixture.item]; expect(() => issueCommand(rows, fixture.user, fixture.stage, [draft()])).toThrow()
  })
  it('rejects rounding before allocating an event', () => {
    const rows = context(); rows.reservations[0].remaining = 1_000_000_000_000
    expect(() => issueCommand(rows, fixture.user, fixture.stage, [{ ...draft(), quantity: '999999999999.999999' }])).toThrow()
    expect(() => issueCommand(rows, fixture.user, fixture.stage, [{ ...draft(), quantity: '123456789012.345678' }])).toThrow()
    expect(issueCommand(context(), fixture.user, fixture.stage, [{ ...draft(), quantity: '0010.000000' }]).lines[0].quantity).toBe(10)
  })
  it('rejects malformed, foreign-org and incomplete option snapshots', async () => {
    rpc.mockResolvedValue({ data: { ...context(), org_id: fixture.mo }, error: null }); await expect(getIssueContext(fixture.org, fixture.mo)).rejects.toThrow('MATERIAL_ISSUE_OPTIONS_INVALID')
    rpc.mockResolvedValue({ data: { org_id: fixture.org, orders: [{ id: 'bad', org_id: fixture.org, label: 'MO' }] }, error: null }); await expect(getIssueOrders(fixture.org)).rejects.toThrow('MATERIAL_ISSUE_OPTIONS_INVALID')
  })
})
