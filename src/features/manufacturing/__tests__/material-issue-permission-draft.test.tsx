import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ user: 'ed000000-0000-4000-8000-0000000000a2', org: 'ed000000-0000-4000-8000-000000000001',
  mo: 'ed000000-0000-4000-8000-000000000010', keys: [] as string[] }))
const pending = vi.hoisted(() => vi.fn())
const manage = vi.hoisted(() => vi.fn())
function translate(key: string) { return key }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: f.user }, currentOrgId: f.org, loading: false }) }))
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ loading: false, error: null,
  permissionIdentityKey: `${f.user}:${f.org}`, hasPermissionKey: (key: string) => f.keys.includes(key) }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: vi.fn() } } }))
vi.mock('@/services/manufacturing/materialIssuePreparation', async original => ({ ...await original<object>(),
  getPreparationCatalog: async () => ({ manufacturing_orders: [{ id: f.mo, org_id: f.org, order_number: 'MO-1', maintenance_version: 1 }],
    work_orders: [], material_reservations: [], products: [], items: [], work_centers: [], manufacturing_stages: [] }) }))
vi.mock('@/services/manufacturing/materialIssueMaintenance', () => ({ listPendingMaterialIssueSetup: pending, manageMaterialIssueSetup: manage }))
vi.mock('@/services/manufacturing/materialIssueOptions', async original => ({ ...await original<object>(), getIssueOrders: async () => [] }))
vi.mock('@/services/manufacturing/materialIssueClient', () => ({ getMaterialIssuePolicy: async () => ({ version: 1 }), pendingMaterialIssue: async () => null }))
vi.mock('../material-issue/MaintenanceRecovery', () => ({ MaintenanceRecovery: () => <p>durable-recovery</p> }))
vi.mock('../components/WipLogFormDialog', () => ({ WipLogFormDialog: () => null }))
import { MaterialIssuePage } from '../material-issue/MaterialIssuePage'
const prepare = 'manufacturing.material_issue_setup.prepare'
const reserve = 'manufacturing.material_reservation.reserve'
const release = 'manufacturing.material_reservation.release'
const consume = 'manufacturing.material_consumption.consume'
const field = () => screen.getByLabelText('materialIssue.preparationWorkName')
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'materialIssue.preparationTitle' }))
  await waitFor(() => expect(screen.getByLabelText('materialIssue.preparationOrder')).toBeEnabled())
  await user.selectOptions(screen.getByLabelText('materialIssue.preparationOrder'), f.mo)
}
beforeEach(() => {
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  f.keys = [prepare, reserve, release, 'manufacturing.orders.create']
  pending.mockReset().mockResolvedValue([{ moId: f.mo }]); manage.mockReset()
})
describe('preparation draft on a background permission snapshot', () => {
  it.each([false, true])('clears an unsent draft after a secondary grant changes, consume=%s', async consuming => {
    if (consuming) f.keys.push(consume)
    // No pending event on the selected MO until after the draft is typed.
    pending.mockResolvedValue([])
    const user = userEvent.setup(); const view = render(<MaterialIssuePage />); await open(user)
    await user.type(field(), 'unsent intent')
    pending.mockResolvedValue([{ moId: f.mo }])
    f.keys = f.keys.filter(key => key !== 'manufacturing.orders.create')
    view.rerender(<MaterialIssuePage />)
    expect(screen.queryByLabelText('materialIssue.preparationWorkName')).not.toBeInTheDocument()
    await open(user); expect(field()).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent('materialIssue.preparationPending')
    expect(screen.getAllByText('durable-recovery').length).toBeGreaterThan(0)
    expect(manage).not.toHaveBeenCalled()
  })
  it('clears on reserve revocation while release-only preparation stays reachable', async () => {
    pending.mockResolvedValue([])
    const user = userEvent.setup(); const view = render(<MaterialIssuePage />); await open(user)
    await user.type(field(), 'unsent intent'); f.keys = [release]; view.rerender(<MaterialIssuePage />)
    expect(screen.getByRole('region', { name: 'materialIssue.preparationTitle' })).toBeVisible()
    expect(screen.queryByLabelText('materialIssue.preparationWorkName')).not.toBeInTheDocument()
    await open(user); expect(field()).toHaveValue(''); expect(manage).not.toHaveBeenCalled()
  })
  it('keeps an unsent draft for reordered, duplicated or unrelated grant keys', async () => {
    pending.mockResolvedValue([])
    const user = userEvent.setup(); const view = render(<MaterialIssuePage />); await open(user)
    await user.type(field(), 'still current')
    f.keys = [...f.keys.reverse(), prepare, 'inventory.products.read']; view.rerender(<MaterialIssuePage />)
    expect(field()).toHaveValue('still current'); expect(manage).not.toHaveBeenCalled()
  })
})
