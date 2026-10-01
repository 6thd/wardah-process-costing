import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ prepare: true, identity: 'actor:org', from: vi.fn(), rpc: vi.fn(),
  recover: vi.fn(), dismiss: vi.fn(), invalidate: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: fixture.invalidate }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' }, currentOrgId: 'org', loading: false }) }))
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ loading: false, error: null,
  permissionIdentityKey: fixture.identity, hasPermissionKey: (key: string) => fixture.prepare && key === 'manufacturing.material_issue_setup.prepare' }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: fixture.from, rpc: fixture.rpc } }))
vi.mock('@/services/manufacturing/materialIssueMaintenance', () => ({ recoverMaterialIssueSetup: fixture.recover,
  acknowledgeRejectedMaterialIssueSetup: fixture.dismiss }))
import { MaterialIssuePage } from '../material-issue/MaterialIssuePage'
beforeEach(() => {
  vi.resetAllMocks(); fixture.prepare = true; fixture.identity = 'actor:org'
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() }
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query)
  query.limit.mockResolvedValue({ data: [{ id: 'mo', order_number: 'Prepared order' }], error: null })
  fixture.from.mockReturnValue(query); fixture.invalidate.mockResolvedValue(undefined)
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
  await screen.findByText('Prepared order')
  fireEvent.change(screen.getByLabelText('materialIssue.mo'), { target: { value: 'mo' } })
  await act(async () => fireEvent.click(screen.getByText('materialIssue.retrySetup')))
  expect(fixture.recover).toHaveBeenCalledWith('mo')
  expect(fixture.from).toHaveBeenCalledWith('manufacturing_orders')
  expect(fixture.from.mock.results[0].value.eq).toHaveBeenCalledWith('org_id', 'org')
  expect(fixture.rpc).not.toHaveBeenCalled()
})
it('denies stale permission identity and performs no reads', () => {
  fixture.identity = 'other:org'; render(<MaterialIssuePage />)
  expect(screen.getByText('materialIssue.denied')).toBeInTheDocument()
  expect(fixture.from).not.toHaveBeenCalled()
})
it('holds production for preparers as well as consumers', () => {
  vi.stubEnv('PROD', true); render(<MaterialIssuePage />)
  expect(screen.getByText('materialIssue.hold')).toBeInTheDocument()
  expect(fixture.from).not.toHaveBeenCalled(); expect(fixture.recover).not.toHaveBeenCalled()
})
