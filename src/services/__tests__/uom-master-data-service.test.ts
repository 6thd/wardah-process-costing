import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
  },
}))

import {
  getProductBaseUomChangeGuard,
  getProductUomMasterProfile,
  listOpenUomBackfillIssues,
  listUomCatalog,
} from '../uom-master-data-service'

function queryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: vi.fn(),
  }

  for (const method of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit']) {
    chain[method].mockReturnValue(chain)
  }
  chain.single.mockResolvedValue(result)
  chain.maybeSingle.mockResolvedValue(result)
  chain.then.mockImplementation((onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected),
  )
  return chain
}

describe('uom-master-data-service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the active UoM catalog in stable order', async () => {
    const categories = queryChain({
      data: [{ id: 'count', code: 'COUNT', name: 'Count', name_ar: 'عدد', dimension: 'count', is_system: true }],
      error: null,
    })
    const uoms = queryChain({
      data: [{
        id: 'piece', code: 'PCS', name: 'Piece', name_ar: 'قطعة', symbol: 'pcs',
        category_id: 'count', is_category_base: true, is_product_specific: false,
        decimal_places: 6,
      }],
      error: null,
    })

    from.mockReturnValueOnce(categories).mockReturnValueOnce(uoms)

    const result = await listUomCatalog('org-1')

    expect(from).toHaveBeenNthCalledWith(1, 'uom_categories')
    expect(from).toHaveBeenNthCalledWith(2, 'uoms')
    expect(uoms.eq).toHaveBeenCalledWith('is_active', true)
    expect(uoms.or).toHaveBeenCalledWith('org_id.is.null,org_id.eq.org-1')
    expect(result.categories).toHaveLength(1)
    expect(result.uoms[0].code).toBe('PCS')
  })

  it('builds an organization-scoped product UoM profile', async () => {
    const product = queryChain({
      data: {
        id: 'product-1', org_id: 'org-1', base_uom_id: 'piece',
        uom_migration_status: 'MAPPED', net_weight: '0.015000',
        gross_weight: '0.017000', weight_uom_id: 'kg',
      },
      error: null,
    })
    const conversions = queryChain({
      data: [{
        id: 'conversion-1', uom_id: 'carton', factor_to_base: '24.000000000000',
        use_for_purchase: true, use_for_sale: true, barcode: null,
        notes: '24 pieces', allow_cross_dimension: false,
        valid_from: '2026-07-22T00:00:00.000Z',
      }],
      error: null,
    })
    const uoms = queryChain({
      data: [
        { id: 'piece', code: 'PCS', name: 'Piece', name_ar: 'قطعة', symbol: 'pcs', category_id: 'count', is_category_base: true, is_product_specific: false, decimal_places: 6 },
        { id: 'carton', code: 'CTN', name: 'Carton', name_ar: 'كرتون', symbol: 'ctn', category_id: 'count', is_category_base: false, is_product_specific: true, decimal_places: 6 },
        { id: 'kg', code: 'KG', name: 'Kilogram', name_ar: 'كيلوجرام', symbol: 'kg', category_id: 'mass', is_category_base: true, is_product_specific: false, decimal_places: 6 },
      ],
      error: null,
    })

    from.mockReturnValueOnce(product).mockReturnValueOnce(conversions).mockReturnValueOnce(uoms)

    const result = await getProductUomMasterProfile('org-1', 'product-1')

    expect(product.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(product.eq).toHaveBeenCalledWith('id', 'product-1')
    expect(conversions.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(conversions.eq).toHaveBeenCalledWith('product_id', 'product-1')
    expect(result.base_uom?.code).toBe('PCS')
    expect(result.weight_uom?.code).toBe('KG')
    expect(result.net_weight).toBe(0.015)
    expect(result.conversions[0].factor_to_base).toBe(24)
  })

  it('locks the base UoM after the first organization-scoped stock movement', async () => {
    const ledger = queryChain({ data: { id: 'sle-1' }, error: null })
    from.mockReturnValue(ledger)

    const guard = await getProductBaseUomChangeGuard('org-1', 'product-1')

    expect(ledger.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(ledger.eq).toHaveBeenCalledWith('product_id', 'product-1')
    expect(guard).toEqual({ has_movements: true, base_uom_locked: true })
  })

  it('keeps the base UoM editable when no stock movement exists', async () => {
    const ledger = queryChain({ data: null, error: null })
    from.mockReturnValue(ledger)

    await expect(getProductBaseUomChangeGuard('org-1', 'product-1')).resolves.toEqual({
      has_movements: false,
      base_uom_locked: false,
    })
  })

  it('returns only open backfill issues for the selected organization', async () => {
    const issues = queryChain({
      data: [{
        id: 'issue-1', org_id: 'org-1', source_table: 'products', source_id: 'product-1',
        source_value: 'كرتون', issue_code: 'AMBIGUOUS_ALIAS', details: {}, status: 'OPEN',
        resolved_uom_id: null, created_at: '2026-07-22T00:00:00.000Z',
      }],
      error: null,
    })
    from.mockReturnValue(issues)

    const result = await listOpenUomBackfillIssues('org-1')

    expect(issues.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(issues.eq).toHaveBeenCalledWith('status', 'OPEN')
    expect(result[0].issue_code).toBe('AMBIGUOUS_ALIAS')
  })
})
