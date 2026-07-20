import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}))

import {
  convertProductQuantity,
  getProductUomOptions,
  getProductWeight,
  saveProductUomConversion,
  setProductPhysicalWeight,
} from '../uom-service'

describe('uom-service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates conversion to the fail-closed database RPC', async () => {
    rpc.mockResolvedValue({ data: {
      success: true, product_id: 'product-1', uom_id: 'carton-uom',
      base_uom_id: 'piece-uom', quantity_entered: 2,
      conversion_factor: 24, base_quantity: 48,
    }, error: null })

    const result = await convertProductQuantity({
      productId: 'product-1', quantity: 2, uomId: 'carton-uom',
      at: '2026-07-20T00:00:00.000Z',
    })

    expect(rpc).toHaveBeenCalledWith('rpc_convert_product_uom', {
      p_product_id: 'product-1', p_quantity: 2, p_uom_id: 'carton-uom',
      p_at: '2026-07-20T00:00:00.000Z',
    })
    expect(result.base_quantity).toBe(48)
    expect(result.conversion_factor).toBe(24)
  })

  it('rejects negative quantities before calling the database', async () => {
    await expect(convertProductQuantity({
      productId: 'product-1', quantity: -1, uomId: 'piece-uom',
    })).rejects.toThrow('UOM_QUANTITY_MUST_BE_NONNEGATIVE')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed conversion responses', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(convertProductQuantity({
      productId: 'product-1', quantity: 1, uomId: 'piece-uom',
    })).rejects.toThrow('INVALID_UOM_CONVERSION_RESPONSE')
  })

  it('returns only the current product conversions after the legal base UoM', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(), eq: vi.fn(), is: vi.fn(), single: vi.fn(),
    }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    chain.is.mockReturnValue(chain)
    chain.single.mockResolvedValue({ data: {
      base_uom_id: 'piece-uom',
      base_uom: {
        id: 'piece-uom', code: 'PCS', name: 'Piece', name_ar: 'قطعة', symbol: 'pcs',
        category_id: 'count', is_category_base: true,
        is_product_specific: false, decimal_places: 6,
      },
      conversions: [{
        factor_to_base: '24', use_for_purchase: false, use_for_sale: true, barcode: null,
        uom: {
          id: 'carton-uom', code: 'CARTON', name: 'Carton', name_ar: 'كرتون', symbol: 'ctn',
          category_id: 'count', is_category_base: false,
          is_product_specific: true, decimal_places: 6,
        },
      }],
    }, error: null })
    from.mockReturnValue(chain)

    const options = await getProductUomOptions('product-1')

    expect(chain.eq).toHaveBeenCalledWith('id', 'product-1')
    expect(chain.eq).toHaveBeenCalledWith('product_uom_conversions.is_active', true)
    expect(chain.is).toHaveBeenCalledWith('product_uom_conversions.valid_to', null)
    expect(options.map((option) => option.code)).toEqual(['PCS', 'CARTON'])
    expect(options[0].factor_to_base).toBe(1)
    expect(options[1].factor_to_base).toBe(24)
  })

  it('fails closed when a product has no base UoM', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(), eq: vi.fn(), is: vi.fn(), single: vi.fn(),
    }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    chain.is.mockReturnValue(chain)
    chain.single.mockResolvedValue({ data: { base_uom_id: null, base_uom: null, conversions: [] }, error: null })
    from.mockReturnValue(chain)
    await expect(getProductUomOptions('product-1')).rejects.toThrow('PRODUCT_BASE_UOM_REQUIRED')
  })

  it('saves cross-dimension product facts through the versioned admin RPC', async () => {
    rpc.mockResolvedValue({ data: { success: true, conversion_id: 'conversion-1' }, error: null })

    await saveProductUomConversion({
      orgId: 'org-1', productId: 'product-1', uomId: 'kg-uom', factorToBase: 1 / 5.4,
      allowCrossDimension: true, notes: 'C1: one carton weighs 5.4 kg',
    })

    expect(rpc).toHaveBeenCalledWith('rpc_set_product_uom_conversion', {
      p_org_id: 'org-1',
      p_product_id: 'product-1',
      p_uom_id: 'kg-uom',
      p_factor_to_base: 1 / 5.4,
      p_use_for_purchase: false,
      p_use_for_sale: false,
      p_barcode: null,
      p_notes: 'C1: one carton weighs 5.4 kg',
      p_allow_cross_dimension: true,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed when the versioned save RPC does not confirm success', async () => {
    rpc.mockResolvedValue({ data: { success: false }, error: null })
    await expect(saveProductUomConversion({
      orgId: 'org-1', productId: 'product-1', uomId: 'kg-uom', factorToBase: 0.2,
    })).rejects.toThrow('UOM_CONVERSION_SAVE_FAILED')
  })

  it('declares physical product weight through the guarded RPC', async () => {
    rpc.mockResolvedValue({ data: { success: true, product_id: 'product-1' }, error: null })

    await setProductPhysicalWeight({
      productId: 'product-1', netWeight: 5.4, grossWeight: 5.65, weightUomId: 'kg-uom',
    })

    expect(rpc).toHaveBeenCalledWith('rpc_set_product_physical_weight', {
      p_product_id: 'product-1', p_net_weight: 5.4,
      p_gross_weight: 5.65, p_weight_uom_id: 'kg-uom',
    })
  })

  it('rejects a gross weight below net weight before calling the RPC', async () => {
    await expect(setProductPhysicalWeight({
      productId: 'product-1', netWeight: 5.4, grossWeight: 5.2, weightUomId: 'kg-uom',
    })).rejects.toThrow('GROSS_WEIGHT_BELOW_NET_WEIGHT')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns derived weight for entered quantities', async () => {
    rpc.mockResolvedValue({ data: {
      success: true, product_id: 'product-1', quantity_entered: 3,
      uom_id: 'carton-uom', base_quantity: 3, weight_uom_id: 'kg-uom',
      net_weight: 16.2, gross_weight: 16.95,
    }, error: null })

    const result = await getProductWeight({
      productId: 'product-1', quantity: 3, uomId: 'carton-uom',
      at: '2026-07-20T00:00:00.000Z',
    })

    expect(result.net_weight).toBe(16.2)
    expect(result.gross_weight).toBe(16.95)
  })

  it('rejects negative weight lookup quantities before calling the RPC', async () => {
    await expect(getProductWeight({
      productId: 'product-1', quantity: -0.1, uomId: 'carton-uom',
    })).rejects.toThrow('UOM_QUANTITY_MUST_BE_NONNEGATIVE')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects non-positive product-specific factors', async () => {
    await expect(saveProductUomConversion({
      orgId: 'org-1', productId: 'product-1', uomId: 'carton-uom', factorToBase: 0,
    })).rejects.toThrow('UOM_FACTOR_MUST_BE_POSITIVE')
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
})