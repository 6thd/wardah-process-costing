import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

import {
  assignProductBaseUom,
  getProductBaseUomChangeGuard,
  getProductUomMasterProfile,
  ignoreUomBackfillIssue,
  uomStatusNeedsSetup,
  listProductUomMappingStatuses,
  listOpenUomBackfillIssues,
  listProductUomConversionHistory,
  listUnmappedProducts,
  listUomCatalog,
  resolveUomBackfillIssue,
} from '../uom-master-data-service'

function queryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: vi.fn(),
  }

  for (const method of ['select', 'eq', 'neq', 'is', 'in', 'or', 'order', 'limit']) {
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

  it('assigns a product base unit through the guarded RPC', async () => {
    rpc.mockResolvedValue({ data: { success: true, base_uom_id: 'piece' }, error: null })

    await assignProductBaseUom({ orgId: 'org-1', productId: 'product-1', uomId: 'piece' })

    expect(rpc).toHaveBeenCalledWith('rpc_assign_product_base_uom', {
      p_org_id: 'org-1',
      p_product_id: 'product-1',
      p_uom_id: 'piece',
    })
  })

  it('fails closed when the base-unit RPC does not confirm success', async () => {
    rpc.mockResolvedValue({ data: { success: false }, error: null })

    await expect(
      assignProductBaseUom({ orgId: 'org-1', productId: 'product-1', uomId: 'piece' }),
    ).rejects.toThrow('PRODUCT_BASE_UOM_ASSIGN_FAILED')
  })

  it('propagates the RPC error from the base-unit assignment', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS') })

    await expect(
      assignProductBaseUom({ orgId: 'org-1', productId: 'product-1', uomId: 'piece' }),
    ).rejects.toThrow('PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS')
  })

  it('resolves a backfill issue with an optional unit and note', async () => {
    rpc.mockResolvedValue({ data: { success: true, status: 'RESOLVED' }, error: null })

    await resolveUomBackfillIssue({ orgId: 'org-1', issueId: 'issue-1', resolvedUomId: 'piece', note: 'fixed' })

    expect(rpc).toHaveBeenCalledWith('rpc_resolve_uom_backfill_issue', {
      p_org_id: 'org-1',
      p_issue_id: 'issue-1',
      p_resolved_uom_id: 'piece',
      p_note: 'fixed',
    })
  })

  it('ignores a backfill issue with a recorded note', async () => {
    rpc.mockResolvedValue({ data: { success: true, status: 'IGNORED' }, error: null })

    await ignoreUomBackfillIssue({ orgId: 'org-1', issueId: 'issue-1', note: 'intentional' })

    expect(rpc).toHaveBeenCalledWith('rpc_ignore_uom_backfill_issue', {
      p_org_id: 'org-1',
      p_issue_id: 'issue-1',
      p_note: 'intentional',
    })
  })

  it('lists unmapped products excluding MAPPED ones for the organization', async () => {
    const products = queryChain({
      data: [{ id: 'p-1', code: 'A1', name: 'Item', name_ar: null, unit: 'box', uom_migration_status: 'AMBIGUOUS' }],
      error: null,
    })
    from.mockReturnValue(products)

    const result = await listUnmappedProducts('org-1')

    expect(from).toHaveBeenCalledWith('products')
    expect(products.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(products.neq).toHaveBeenCalledWith('uom_migration_status', 'MAPPED')
    expect(result[0].uom_migration_status).toBe('AMBIGUOUS')
  })

  it('projects product UoM statuses from the products table and flags non-mapped', async () => {
    const products = queryChain({
      data: [
        { id: 'p-1', uom_migration_status: 'MAPPED' },
        { id: 'p-2', uom_migration_status: 'NO_UNIT' },
      ],
      error: null,
    })
    from.mockReturnValue(products)

    const result = await listProductUomMappingStatuses('org-1')

    expect(from).toHaveBeenCalledWith('products')
    expect(products.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(result).toHaveLength(2)
    expect(uomStatusNeedsSetup('MAPPED')).toBe(false)
    expect(uomStatusNeedsSetup('NO_UNIT')).toBe(true)
    expect(uomStatusNeedsSetup(undefined)).toBe(true)
  })

  it('returns the full versioned conversion history newest first', async () => {
    const history = queryChain({
      data: [
        { id: 'c-2', uom_id: 'carton', factor_to_base: '24', is_active: true, valid_from: '2026-07-22T00:00:00.000Z', valid_to: null },
        { id: 'c-1', uom_id: 'carton', factor_to_base: '12', is_active: false, valid_from: '2026-07-01T00:00:00.000Z', valid_to: '2026-07-22T00:00:00.000Z' },
      ],
      error: null,
    })
    const uoms = queryChain({
      data: [{ id: 'carton', code: 'CTN', name: 'Carton', name_ar: 'كرتون', symbol: 'ctn', category_id: 'count', is_category_base: false, is_product_specific: true, decimal_places: 6 }],
      error: null,
    })
    from.mockReturnValueOnce(history).mockReturnValueOnce(uoms)

    const result = await listProductUomConversionHistory('org-1', 'product-1')

    expect(history.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(history.eq).toHaveBeenCalledWith('product_id', 'product-1')
    expect(result).toHaveLength(2)
    expect(result[0].factor_to_base).toBe(24)
    expect(result[0].is_active).toBe(true)
    expect(result[1].valid_to).toBe('2026-07-22T00:00:00.000Z')
    expect(result[0].uom?.code).toBe('CTN')
  })
})
