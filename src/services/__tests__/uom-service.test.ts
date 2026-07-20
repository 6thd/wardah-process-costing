import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}))

import { convertProductQuantity, getProductUomOptions, saveProductUomConversion } from '../uom-service'

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

  it('returns the legal base UoM before product conversions', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(), eq: vi.fn(), single: vi.fn(),
    }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
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
    expect(options.map((option) => option.code)).toEqual(['PCS', 'CARTON'])
    expect(options[0].factor_to_base).toBe(1)
    expect(options[1].factor_to_base).toBe(24)
  })

  it('fails closed when a product has no base UoM', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(), eq: vi.fn(), single: vi.fn(),
    }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    chain.single.mockResolvedValue({ data: { base_uom_id: null, base_uom: null, conversions: [] }, error: null })
    from.mockReturnValue(chain)
    await expect(getProductUomOptions('product-1')).rejects.toThrow('PRODUCT_BASE_UOM_REQUIRED')
  })

  it('rejects non-positive product-specific factors', async () => {
    await expect(saveProductUomConversion({
      orgId: 'org-1', productId: 'product-1', uomId: 'carton-uom', factorToBase: 0,
    })).rejects.toThrow('UOM_FACTOR_MUST_BE_POSITIVE')
    expect(from).not.toHaveBeenCalled()
  })
})
