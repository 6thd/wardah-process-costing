import { beforeEach, describe, expect, it, vi } from 'vitest'
const env = vi.hoisted(() => ({ org: 'ed000000-0000-4000-8000-000000000001', actor: 'ed000000-0000-4000-8000-0000000000a2' }))
const getUser = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ getEffectiveTenantId: async () => env.org, supabase: { from, rpc, auth: { getUser } } }))
import { getPreparationCatalog, getPreparationReservationUnit, preparationQuantity, preparationKeys, preparationStatus, reservationBalance,
  resizePreparationReservation, releasePreparationReservation, type PreparationRow } from '../materialIssuePreparation'
const mo = 'ed000000-0000-4000-8000-000000000010'
const product: PreparationRow = { id: 'ed000000-0000-4000-8000-0000000000c1', org_id: env.org, base_uom_id: 'ed000000-0000-4000-8000-000000000040' }
const reservation = (): PreparationRow => ({ id: 'ed000000-0000-4000-8000-000000000030', org_id: env.org, mo_id: mo,
  product_id: product.id, uom_id: product.base_uom_id, conversion_factor_snapshot: 1, quantity_reserved: 25,
  quantity_consumed: 0, quantity_released: 0, status: 'reserved', maintenance_version: 7 })
beforeEach(() => {
  vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  getUser.mockReset().mockResolvedValue({ data: { user: { id: env.actor } }, error: null })
  from.mockReset().mockImplementation(() => { const query = { select: () => query, eq: () => query,
    order: () => query, gt: () => query, limit: async () => ({ data: [], error: null }), range: async () => ({ data: [], error: null }) }; return query })
})
describe('displayed preparation intent', () => {
  it.each(['0', '-1', '1e2', ' 1', '١٠', '0.0000001', '1.2345678', '999999999999.999999', '1000000000000', 'NaN', 'Infinity'])('refuses noncanonical quantity %s', text => {
    expect(() => preparationQuantity(text)).toThrow('INVALID_BASE_QUANTITY')
  })
  it.each(['1', '0.000001', '10.125', '01.00'])('accepts exact base quantity %s', text => expect(preparationQuantity(text)).toBe(Number(text)))
  it('limits WO precision and carries the version the operator viewed', () => {
    expect(() => preparationQuantity('1.00001', 4, 100_000_000)).toThrow()
    expect(preparationStatus({ id: mo, org_id: env.org, maintenance_version: 3 }, 'in_progress')).toEqual({ operation: 'set_order_status', mo_id: mo, status: 'in_progress', expected_version: 3 })
    expect(preparationStatus({ id: reservation().id, org_id: env.org, mo_id: mo, maintenance_version: 2 }, 'READY', true).expected_version).toBe(2)
  })
  it.each([null, 0, -1, 1.1, 9e20])('rejects invalid displayed version %s', maintenance_version => {
    expect(() => preparationStatus({ id: mo, org_id: env.org, maintenance_version }, 'confirmed')).toThrow()
  })
  it.each(['completed', 'done', 'cancelled', 'DRAFT'])('refuses terminal status %s', status => expect(() => preparationStatus(reservation(), status)).toThrow())
  it('resizes pristine base units and preserves history on release', () => {
    expect(resizePreparationReservation(reservation(), product, '36')).toMatchObject({ quantity: 36, expected_version: 7 })
    const row = { ...reservation(), quantity_consumed: 10, quantity_released: 3 }
    expect(reservationBalance(row)).toBe(12)
    expect(releasePreparationReservation(row, '12')).toMatchObject({ operation: 'release_reservation', quantity: 12, expected_version: 7 })
    expect(row.quantity_consumed).toBe(10)
    expect(() => releasePreparationReservation(row, '13')).toThrow()
  })
  it.each([{ conversion_factor_snapshot: 12 }, { uom_id: mo }, { quantity_consumed: 1 }, { quantity_released: 1 },
    { status: 'released' }, { expires_at: '2000-01-01' }, { expires_at: 'invalid' }])('rejects historical or nonbase resize %j', patch => {
    expect(() => resizePreparationReservation({ ...reservation(), ...patch }, product, '36')).toThrow()
  })
  it.each([{ quantity_reserved: -1 }, { quantity_consumed: 26 }, { quantity_released: 'NaN' }])('rejects inconsistent balance %j', patch => {
    expect(() => reservationBalance({ ...reservation(), ...patch })).toThrow()
  })
  it('requires operation-specific keys without reserve/release conflation', () => {
    expect(preparationKeys('reserve')).toEqual(['manufacturing.material_reservation.reserve'])
    expect(preparationKeys('resize_reservation')).toEqual(preparationKeys('reserve'))
    expect(preparationKeys('release_reservation')).toEqual(['manufacturing.material_reservation.release'])
    expect(preparationKeys('create_order')).toContain('manufacturing.orders.create')
    expect(preparationKeys('set_order_status')).toContain('manufacturing.orders.update')
    expect(preparationKeys('open_stage_wip')).toContain('manufacturing.stage_costs.create')
    expect(preparationKeys('create_work_order')).toEqual(preparationKeys('set_work_order_status'))
  })
})
describe('org and actor verified catalog', () => {
  function pagedRows(count: number, cap: number, removeFirst = false) {
    let rows = Array.from({ length: count }, (_, i) => ({ id: `aa000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, org_id: env.org }))
    const initial = [...rows]; let calls = 0
    from.mockImplementation((table: string) => {
      let after = ''
      const page = (start: number, size: number) => {
        if (table !== 'manufacturing_orders') return { data: [], error: null }
        if (++calls === 2 && removeFirst) rows = rows.slice(1)
        return { data: rows.filter(row => row.id > after).slice(start, start + Math.min(size, cap)), error: null }
      }
      const q = { select: () => q, eq: () => q, order: () => q,
        gt: (_key: string, value: string) => { after = value; return q },
        limit: async (size: number) => page(0, size), range: async (start: number, end: number) => page(start, end - start + 1) }
      return q
    })
    return { initial, calls: () => calls }
  }
  it.each([100, 500])('reads every order under a server row cap of %s and stops on an empty page', async cap => {
    const fixture = pagedRows(501, cap)
    expect((await getPreparationCatalog(env.org, env.actor)).manufacturing_orders).toEqual(fixture.initial)
    expect(fixture.calls()).toBe(Math.ceil(501 / cap) + 1)
    expect(getUser).toHaveBeenCalledTimes(2)
  })
  it('does not skip an unread order when an earlier row is deleted between pages', async () => {
    const fixture = pagedRows(501, 500, true)
    expect((await getPreparationCatalog(env.org, env.actor)).manufacturing_orders).toEqual(fixture.initial)
  })
  it.each(['foreign', 'duplicate', 'malformed', 'failure'])('fails closed on %s catalog', kind => {
    from.mockImplementation(() => { const q = { select: () => q, eq: () => q, order: () => q, gt: () => q, limit: async () => ({
      data: kind === 'foreign' ? [{ ...reservation(), org_id: mo }] : kind === 'duplicate' ? [reservation(), reservation()] : null,
      error: kind === 'failure' ? new Error('denied') : null }) }; return { ...q, range: q.limit } })
    return expect(getPreparationCatalog(env.org, env.actor)).rejects.toThrow()
  })
  it.each(['unordered', 'replayed', 'invalid_id'])('rejects %s pages instead of looping or returning a partial catalog', kind => {
    let calls = 0
    const row = (suffix: string) => ({ id: `aa000000-0000-4000-8000-${suffix.padStart(12, '0')}`, org_id: env.org })
    from.mockImplementation((table: string) => {
      const q = { select: () => q, eq: () => q, order: () => q, gt: () => q, limit: async () => ({
        data: table !== 'manufacturing_orders' ? [] : kind === 'invalid_id' ? [{ id: 'invalid', org_id: env.org }]
          : kind === 'unordered' ? [row('2'), row('1')] : ++calls === 1 ? [row('2')] : [row('1')], error: null }) }
      return q
    })
    return expect(getPreparationCatalog(env.org, env.actor)).rejects.toThrow('ISSUE_SETUP_CATALOG_UNVERIFIED')
  })
  it('ignores data returned after an identity change', () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: env.actor } }, error: null }).mockResolvedValueOnce({ data: { user: { id: mo } }, error: null })
    return expect(getPreparationCatalog(env.org, env.actor)).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
  })
  it('does not read when Production hold or wrong org applies', async () => {
    vi.stubEnv('PROD', true); await expect(getPreparationCatalog(env.org, env.actor)).rejects.toThrow('MATERIAL_ISSUE_RELEASE_HOLD')
    vi.stubEnv('PROD', false); await expect(getPreparationCatalog(mo, env.actor)).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
    expect(from).not.toHaveBeenCalled()
  })
})

describe('displayed base unit', () => {
  it('verifies org/item/product/unit and actor before exposing a base quantity', async () => {
    rpc.mockResolvedValue({ data: { org_id: env.org, item_id: mo, product_id: product.id, uom_id: product.base_uom_id }, error: null })
    expect((await getPreparationReservationUnit(env.org, mo, env.actor)).uom_id).toBe(product.base_uom_id)
    expect(rpc).toHaveBeenCalledWith('rpc_get_material_reservation_setup', { p_org_id: env.org, p_item_id: mo })
  })
  it.each(['org_id','item_id','product_id','uom_id'])('refuses an unverified %s', key => {
    rpc.mockResolvedValue({ data: { org_id: env.org, item_id: mo, product_id: product.id, uom_id: product.base_uom_id, [key]: '' }, error: null })
    return expect(getPreparationReservationUnit(env.org, mo, env.actor)).rejects.toThrow('ISSUE_SETUP_RESULT_UNVERIFIED')
  })
  it('refuses revoked identity, RPC errors and Production before display', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('permission') })
    await expect(getPreparationReservationUnit(env.org, mo, env.actor)).rejects.toThrow('permission')
    vi.stubEnv('PROD', true); await expect(getPreparationReservationUnit(env.org, mo, env.actor)).rejects.toThrow('MATERIAL_ISSUE_RELEASE_HOLD')
    vi.stubEnv('PROD', false); await expect(getPreparationReservationUnit(env.org, '', env.actor)).rejects.toThrow('INVALID_ISSUE_SETUP_SCOPE')
    getUser.mockResolvedValue({ data: { user: { id: mo } }, error: null })
    await expect(getPreparationReservationUnit(env.org, mo, env.actor)).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
  })
})
