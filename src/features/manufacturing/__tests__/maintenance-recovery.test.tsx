import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ allowed: true, identity: 'actor:org', recover: vi.fn(), dismiss: vi.fn(), invalidate: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: fixture.invalidate }) }))
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ loading: false, error: null,
  permissionIdentityKey: fixture.identity, hasPermissionKey: () => fixture.allowed }) }))
vi.mock('@/services/manufacturing/materialIssueMaintenance', () => ({ recoverMaterialIssueSetup: fixture.recover,
  acknowledgeRejectedMaterialIssueSetup: fixture.dismiss }))
import { MaintenanceRecovery } from '../material-issue/MaintenanceRecovery'
beforeEach(() => { vi.resetAllMocks(); fixture.allowed = true; fixture.identity = 'actor:org'; fixture.invalidate.mockResolvedValue(undefined) })
afterEach(cleanup)
it('denies stale identity and missing permissions without touching storage', () => {
  fixture.allowed = false; const page = render(<MaintenanceRecovery identity="actor:org" />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  fixture.allowed = true; fixture.identity = 'other:org'; page.rerender(<MaintenanceRecovery identity="actor:org" />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(fixture.recover).not.toHaveBeenCalled()
})
it('recovers creation separately from selected-MO preparation', async () => {
  render(<MaintenanceRecovery identity="actor:org" moId="mo" />)
  await act(async () => fireEvent.click(screen.getByText('materialIssue.retryOrderCreation')))
  expect(fixture.recover).toHaveBeenCalledWith(undefined)
  await act(async () => fireEvent.click(screen.getByText('materialIssue.retrySetup')))
  expect(fixture.recover).toHaveBeenCalledWith('mo')
  expect(fixture.invalidate).toHaveBeenCalledTimes(2)
})
it('disables selected-MO recovery until an order is selected', () => {
  render(<MaintenanceRecovery identity="actor:org" />)
  expect(screen.getByText('materialIssue.retrySetup')).toBeDisabled()
  expect(screen.getByText('materialIssue.dismissRejectedSetup')).toBeDisabled()
})
it('dismisses only through the definitive-rejection guard and never invalidates on failure', async () => {
  fixture.dismiss.mockRejectedValue(new Error('ISSUE_SETUP_OUTCOME_UNRESOLVED'))
  render(<MaintenanceRecovery identity="actor:org" moId="mo" />)
  await act(async () => fireEvent.click(screen.getByText('materialIssue.dismissRejectedSetup')))
  expect(fixture.dismiss).toHaveBeenCalledWith('mo')
  expect(await screen.findByText('materialIssue.setupUnresolved')).toBeInTheDocument()
  expect(fixture.invalidate).not.toHaveBeenCalled()
})
it('does not apply a late result after permission revocation', async () => {
  let finish!: () => void
  fixture.recover.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const page = render(<MaintenanceRecovery identity="actor:org" moId="mo" />)
  fireEvent.click(screen.getByText('materialIssue.retrySetup'))
  fixture.allowed = false; page.rerender(<MaintenanceRecovery identity="actor:org" moId="mo" />)
  await act(async () => finish())
  expect(fixture.invalidate).not.toHaveBeenCalled()
})
