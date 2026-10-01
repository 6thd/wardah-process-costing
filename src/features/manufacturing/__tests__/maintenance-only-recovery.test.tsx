import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ prepare: true, identity: 'actor:org', from: vi.fn(), rpc: vi.fn(),
  recover: vi.fn(), dismiss: vi.fn(), reconcile: vi.fn(), pending: vi.fn(), invalidate: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: fixture.invalidate }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' }, currentOrgId: 'org', loading: false }) }))
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ loading: false, error: null,
  permissionIdentityKey: fixture.identity, hasPermissionKey: (key: string) => fixture.prepare && key === 'manufacturing.material_issue_setup.prepare' }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: fixture.from, rpc: fixture.rpc } }))
vi.mock('@/services/manufacturing/materialIssueMaintenance', () => ({ recoverMaterialIssueSetup: fixture.recover,
  acknowledgeRejectedMaterialIssueSetup: fixture.dismiss, reconcileMaterialIssueSetup: fixture.reconcile,
  listPendingMaterialIssueSetup: fixture.pending }))
import { MaterialIssuePage } from '../material-issue/MaterialIssuePage'
beforeEach(() => {
  vi.resetAllMocks(); fixture.prepare = true; fixture.identity = 'actor:org'
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  fixture.pending.mockResolvedValue([{ eventId: 'event', moId: 'mo', operation: 'reserve' }])
  fixture.invalidate.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
it('lets a preparer recover creation without granting material consumption', async () => {
  render(<MaterialIssuePage />)
  await act(async () => fireEvent.click(screen.getByText('materialIssue.retryOrderCreation')))
  expect(fixture.recover).toHaveBeenCalledWith(undefined)
  expect(fixture.rpc).not.toHaveBeenCalled()
  expect(screen.queryByText('materialIssue.submit')).not.toBeInTheDocument()
})
it('offers scoped MO recovery and never calls consume-only read RPCs', async () => {
  render(<MaterialIssuePage />)
  await screen.findByRole('option', { name: 'mo' })
  fireEvent.change(screen.getByLabelText('materialIssue.mo'), { target: { value: 'mo' } })
  await act(async () => fireEvent.click(screen.getByText('materialIssue.retrySetup')))
  expect(fixture.recover).toHaveBeenCalledWith('mo')
  expect(fixture.pending).toHaveBeenCalled()
  expect(fixture.from).not.toHaveBeenCalled()
  expect(fixture.rpc).not.toHaveBeenCalled()
})
it('denies stale permission identity and performs no reads', () => {
  fixture.identity = 'other:org'; render(<MaterialIssuePage />)
  expect(screen.getByText('materialIssue.denied')).toBeInTheDocument()
  expect(fixture.from).not.toHaveBeenCalled()
  expect(fixture.pending).not.toHaveBeenCalled()
})
it('holds production for preparers as well as consumers', () => {
  vi.stubEnv('PROD', true); render(<MaterialIssuePage />)
  expect(screen.getByText('materialIssue.hold')).toBeInTheDocument()
  expect(fixture.from).not.toHaveBeenCalled(); expect(fixture.recover).not.toHaveBeenCalled()
  expect(fixture.pending).not.toHaveBeenCalled()
})
it('exposes a recent pending order beyond 200 entries and refreshes after recovery', async () => {
  fixture.pending.mockResolvedValue(Array.from({ length: 250 }, (_, i) => ({ eventId: `event-${i}`, moId: `mo-${i}`, operation: 'reserve' })))
  fixture.reconcile.mockResolvedValue('closed')
  render(<MaterialIssuePage />)
  // Match the same last option without computing 250 accessible names under coverage.
  await screen.findByText('mo-249', { selector: 'option' })
  fireEvent.change(screen.getByLabelText('materialIssue.mo'), { target: { value: 'mo-249' } })
  await act(async () => fireEvent.click(screen.getByText('materialIssue.reconcileSetup')))
  expect(fixture.reconcile).toHaveBeenCalledWith('mo-249')
  expect(fixture.pending).toHaveBeenCalledTimes(2)
  expect(fixture.from).not.toHaveBeenCalled()
})
it('reports storage failure without a misleading empty success', async () => {
  fixture.pending.mockRejectedValue(new Error('storage failed')); render(<MaterialIssuePage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('materialIssue.storageFailed')
})
