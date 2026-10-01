import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ org: 'ed000000-0000-4000-8000-000000000001', user: 'ed000000-0000-4000-8000-0000000000a2',
  mo: 'ed000000-0000-4000-8000-000000000010', wo: 'ed000000-0000-4000-8000-000000000020',
  res: 'ed000000-0000-4000-8000-000000000030', uom: 'ed000000-0000-4000-8000-000000000040',
  product: 'ed000000-0000-4000-8000-0000000000c1', item: 'ed000000-0000-4000-8000-0000000000d1',
  center: 'ed000000-0000-4000-8000-0000000000f2', keys: [] as string[], loading: false, error: null as Error | null, identity: '' }))
const catalog = vi.hoisted(() => vi.fn())
const pending = vi.hoisted(() => vi.fn())
const manage = vi.hoisted(() => vi.fn())
const unit = vi.hoisted(() => vi.fn())
const getUser = vi.hoisted(() => vi.fn())
const invalidate = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
function translate(key: string) { return key }
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser } } }))
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ loading: f.loading, error: f.error,
  permissionIdentityKey: f.identity, hasPermissionKey: (key: string) => f.keys.includes(key) }) }))
vi.mock('@/services/manufacturing/materialIssuePreparation', async original => ({ ...await original<object>(), getPreparationCatalog: catalog, getPreparationReservationUnit: unit }))
vi.mock('@/services/manufacturing/materialIssueMaintenance', () => ({ manageMaterialIssueSetup: manage, listPendingMaterialIssueSetup: pending }))
vi.mock('../material-issue/MaintenanceRecovery', () => ({ MaintenanceRecovery: () => <p>recovery-independent</p> }))
vi.mock('../components/WipLogFormDialog', () => ({ WipLogFormDialog: ({ open, canSubmit }: { open: boolean; canSubmit: boolean }) => open ? <div role="dialog">{String(canSubmit)}</div> : null }))
import { MaterialIssuePreparation } from '../material-issue/MaterialIssuePreparation'
import { MaterialIssueDecisionDraft } from '../material-issue/MaterialIssueDecisionDraft'
function rows() { return {
  manufacturing_orders: [{ id: f.mo, org_id: f.org, order_number: 'MO-1', status: 'in_progress', quantity: 5, maintenance_version: 3 }],
  work_orders: [{ id: f.wo, org_id: f.org, mo_id: f.mo, operation_name: 'Manual WO', status: 'READY', maintenance_version: 4 }],
  material_reservations: [{ id: f.res, org_id: f.org, mo_id: f.mo, product_id: f.product, uom_id: f.uom,
    quantity_reserved: 25, quantity_consumed: 0, quantity_released: 0, status: 'reserved', conversion_factor_snapshot: 1, maintenance_version: 7 }],
  products: [{ id: f.product, org_id: f.org, name: 'Product', base_uom_id: f.uom, is_active: true }],
  items: [{ id: f.item, org_id: f.org, name: 'Raw' }],
  work_centers: [{ id: f.center, org_id: f.org, name: 'Center', is_active: true }], manufacturing_stages: [],
} }
const button = (name: string) => screen.getByRole('button', { name: `materialIssue.${name}` })
const field = (name: string) => screen.getByLabelText(`materialIssue.${name}`)
async function open() {
  const user = userEvent.setup(); render(<MaterialIssuePreparation userId={f.user} orgId={f.org} />)
  expect(catalog).not.toHaveBeenCalled(); await user.click(button('preparationTitle'))
  await waitFor(() => expect(field('preparationOrder')).toBeEnabled())
  await user.selectOptions(field('preparationOrder'), f.mo); return user
}
beforeEach(() => {
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  f.keys = ['manufacturing.material_issue_setup.prepare', 'manufacturing.material_reservation.reserve', 'manufacturing.material_reservation.release',
    'manufacturing.orders.create', 'manufacturing.orders.update', 'manufacturing.stage_costs.create']
  f.identity = `${f.user}:${f.org}`; f.loading = false; f.error = null
  catalog.mockReset().mockResolvedValue(rows()); pending.mockReset().mockResolvedValue([])
  manage.mockReset().mockResolvedValue({ id: f.mo }); unit.mockReset().mockResolvedValue({ org_id: f.org, item_id: f.item, product_id: f.product, uom_id: f.uom })
  getUser.mockReset().mockResolvedValue({ data: { user: { id: f.user } }, error: null }); invalidate.mockReset().mockResolvedValue(undefined)
})
describe('mounted preparation controls', () => {
  it('creates a product-only draft and a manual WO through the existing gateway', async () => {
    const user = await open()
    await user.selectOptions(field('preparationProduct'), f.product)
    await user.type(field('preparationOrderNumber'), 'MO-NEW'); await user.type(field('preparationOrderQuantity'), '5')
    await user.click(button('createPreparationOrder'))
    expect(manage).toHaveBeenCalledWith({ operation: 'create_order', order: { product_id: f.product, order_number: 'MO-NEW', quantity: 5 }, materials: [] })
    await waitFor(() => expect(field('preparationWorkCenter')).toBeEnabled())
    await user.selectOptions(field('preparationWorkCenter'), f.center); await user.type(field('preparationWorkName'), 'Manual')
    await user.type(field('preparationWorkQuantity'), '5'); await user.click(button('createPreparationWorkOrder'))
    expect(manage).toHaveBeenLastCalledWith({ operation: 'create_work_order', mo_id: f.mo, work_center_id: f.center, name: 'Manual', quantity: 5 })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
  it('uses displayed MO and WO versions without a fresh version read at submit', async () => {
    const user = await open(); await user.selectOptions(field('preparationOrderStatus'), 'on_hold'); await user.click(button('saveOrderEligibility'))
    expect(manage).toHaveBeenCalledWith({ operation: 'set_order_status', mo_id: f.mo, status: 'on_hold', expected_version: 3 })
    await waitFor(() => expect(field('preparationWorkOrder')).toBeEnabled())
    await user.selectOptions(field('preparationWorkOrder'), f.wo); await user.selectOptions(field('preparationWorkStatus'), 'IN_PROGRESS')
    await user.click(button('saveWorkEligibility'))
    expect(manage).toHaveBeenLastCalledWith({ operation: 'set_work_order_status', mo_id: f.mo, work_order_id: f.wo, status: 'IN_PROGRESS', expected_version: 4 })
  })
  it('resolves reservation units before claiming; resizes total and releases only the requested balance', async () => {
    const user = await open(); await user.selectOptions(field('preparationItem'), f.item)
    await user.type(field('preparationReserveQuantity'), '20'); await user.click(button('createPreparationReservation'))
    expect(unit).toHaveBeenCalledWith(f.org, f.item, f.user); expect(manage).toHaveBeenCalledWith({ operation: 'reserve', mo_id: f.mo, item_id: f.item, uom_id: f.uom, quantity: 20 })
    await waitFor(() => expect(field('preparationReservation')).toBeEnabled())
    await user.selectOptions(field('preparationReservation'), f.res); await user.type(field('preparationChangeQuantity'), '30')
    await user.click(button('resizePreparationReservation'))
    expect(manage).toHaveBeenCalledWith({ operation: 'resize_reservation', mo_id: f.mo, reservation_id: f.res, quantity: 30, expected_version: 7 })
    await waitFor(() => expect(field('preparationChangeQuantity')).toBeEnabled())
    await user.clear(field('preparationChangeQuantity')); await user.type(field('preparationChangeQuantity'), '10')
    await user.click(button('releasePreparationReservation'))
    expect(manage).toHaveBeenLastCalledWith({ operation: 'release_reservation', mo_id: f.mo, reservation_id: f.res, quantity: 10, expected_version: 7 })
  })
  it('makes release-only access useful without granting preparation or reservation', async () => {
    f.keys = ['manufacturing.material_reservation.release']; const user = await open()
    await user.selectOptions(field('preparationReservation'), f.res); await user.type(field('preparationChangeQuantity'), '5')
    expect(button('releasePreparationReservation')).toBeEnabled(); expect(button('resizePreparationReservation')).toBeDisabled()
    expect(button('createPreparationOrder')).toBeDisabled(); expect(button('openPreparationStage')).toBeDisabled()
    await user.click(button('releasePreparationReservation')); expect(manage).toHaveBeenCalledTimes(1)
  })
  it.each(['precision', 'history', 'overbalance'])('blocks %s before persistence or RPC', async kind => {
    if (kind === 'history') catalog.mockResolvedValue({ ...rows(), material_reservations: [{ ...rows().material_reservations[0], quantity_consumed: 10 }] })
    const user = await open(); await user.selectOptions(field('preparationReservation'), f.res)
    await user.type(field('preparationChangeQuantity'), kind === 'precision' ? '1.0000001' : kind === 'overbalance' ? '26' : '30')
    await user.click(button(kind === 'overbalance' ? 'releasePreparationReservation' : 'resizePreparationReservation'))
    expect(manage).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent('materialIssue.preparationInvalid')
  })
  it('does not claim a reservation until its displayed base unit is verified', async () => {
    unit.mockRejectedValue(new Error('permission')); const user = await open()
    await user.selectOptions(field('preparationItem'), f.item); await user.type(field('preparationReserveQuantity'), '5')
    await screen.findByText('materialIssue.preparationUnitFailed'); expect(button('createPreparationReservation')).toBeDisabled()
    expect(manage).not.toHaveBeenCalled()
  })
  it('keeps pending recovery reachable while blocking new commands', async () => {
    pending.mockResolvedValue([{ moId: f.mo }]); await open()
    expect(screen.getByText('recovery-independent')).toBeVisible(); expect(screen.getByRole('alert')).toHaveTextContent('materialIssue.preparationPending')
    expect(button('createPreparationWorkOrder')).toBeDisabled(); expect(button('openPreparationStage')).toBeDisabled()
  })
  it.each(['storage', 'catalog'])('fails closed if %s loading fails', async source => {
    if (source === 'storage') pending.mockRejectedValue(new Error('storage')); else catalog.mockRejectedValue(new Error('read'))
    const user = userEvent.setup(); render(<MaterialIssuePreparation userId={f.user} orgId={f.org} />); await user.click(button('preparationTitle'))
    await screen.findByText('materialIssue.preparationLoadFailed'); expect(button('createPreparationOrder')).toBeDisabled()
    expect(manage).not.toHaveBeenCalled(); expect(screen.getByText('recovery-independent')).toBeVisible()
  })
  it('rechecks permission after identity await and ignores unmounted completions', async () => {
    const user = await open(); await user.selectOptions(field('preparationOrderStatus'), 'on_hold')
    getUser.mockImplementation(async () => { f.keys = []; return { data: { user: { id: f.user } }, error: null } })
    await user.click(button('saveOrderEligibility')); expect(manage).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled()
  })
  it('shows recovery after stale rejection and never invalidates unverified writes', async () => {
    const user = await open(); manage.mockRejectedValue(new Error('ISSUE_SETUP_STALE_VERSION'))
    await user.selectOptions(field('preparationOrderStatus'), 'confirmed'); await user.click(button('saveOrderEligibility'))
    await screen.findByText('materialIssue.preparationFailed'); expect(invalidate).not.toHaveBeenCalled()
    expect(screen.getByText('recovery-independent')).toBeVisible()
  })
  it('mounts the existing pristine WIP dialog with explicit grants', async () => {
    const user = await open(); await user.click(button('openPreparationStage'))
    expect(screen.getByRole('dialog')).toHaveTextContent('true')
  })
})
describe('reviewable decision UI', () => {
  it('starts with no policy selected and resets acknowledgement after each change', async () => {
    const user = userEvent.setup(); render(<MaterialIssueDecisionDraft userId={f.user} orgId={f.org} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await user.selectOptions(field('grantArrangement'), 'separated'); await user.selectOptions(field('deviceArrangement'), 'coordinated_devices')
    expect(screen.queryByRole('link')).not.toBeInTheDocument(); await user.click(screen.getByRole('checkbox'))
    const link = screen.getByRole('link'); expect(link).toHaveAttribute('download', 'wardah-material-issue-decision.json')
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('"release_ready": false')
    await user.selectOptions(field('deviceArrangement'), 'server_lease_required')
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('materialIssue.leaseUnavailable')
    expect(manage).not.toHaveBeenCalled(); expect(unit).not.toHaveBeenCalled()
  })
})
