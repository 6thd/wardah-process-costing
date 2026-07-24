import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '@/lib/supabase'
import {
  createAtomicUomPurchaseOrder,
  listPurchaseProductUoms,
  listUomPurchaseOrderOptions,
  mapPurchaseOrderError,
} from '../purchase-order-service'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

const rpc = vi.mocked(supabase.rpc)

const input = {
  org_id: 'org-1',
  vendor_id: 'vendor-1',
  order_date: '2026-07-24',
  expected_delivery_date: null,
  notes: null,
  lines: [{
    product_id: 'product-1',
    description: 'صنف',
    uom_id: 'carton',
    qty_entered: 2,
    unit_price_entered: 120,
    discount_percentage: 0,
    tax_percentage: 15,
  }],
}

describe('purchase-order-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads form options for the explicitly selected organization', async () => {
    rpc.mockResolvedValue({
      data: {
        vendors: [{ id: 'vendor-1', code: 'V1', name: 'Vendor 1' }],
        products: [{
          id: 'product-1',
          code: 'P1',
          name: 'Product 1',
          name_ar: null,
          cost_price: 10,
          uom_migration_status: 'MAPPED',
        }],
      },
      error: null,
    } as never)

    const result = await listUomPurchaseOrderOptions('org-2')

    expect(rpc).toHaveBeenCalledWith('rpc_list_uom_purchase_order_options', {
      p_org_id: 'org-2',
    })
    expect(result.vendors).toHaveLength(1)
    expect(result.products[0].id).toBe('product-1')
  })

  it('loads legal product units for the explicitly selected organization', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: 'carton',
        code: 'CTN',
        name: 'Carton',
        name_ar: 'كرتون',
        symbol: 'ctn',
        category_id: 'count',
        is_category_base: false,
        is_product_specific: true,
        decimal_places: 2,
        factor_to_base: 24,
        is_base: false,
        use_for_purchase: true,
        use_for_sale: false,
        barcode: null,
      }],
      error: null,
    } as never)

    const result = await listPurchaseProductUoms('org-2', 'product-1')

    expect(rpc).toHaveBeenCalledWith('rpc_get_purchase_product_uoms', {
      p_org_id: 'org-2',
      p_product_id: 'product-1',
    })
    expect(result[0].factor_to_base).toBe(24)
  })

  it('calls the atomic RPC once and parses the authoritative totals', async () => {
    rpc.mockResolvedValue({
      data: {
        success: true,
        purchase_order_id: 'po-1',
        order_number: 'PO-20260724-ABC12345',
        line_count: 1,
        subtotal: 240,
        discount_amount: 0,
        tax_amount: 36,
        total_amount: 276,
      },
      error: null,
    } as never)

    await expect(createAtomicUomPurchaseOrder(input)).resolves.toEqual({
      success: true,
      purchase_order_id: 'po-1',
      order_number: 'PO-20260724-ABC12345',
      line_count: 1,
      subtotal: 240,
      discount_amount: 0,
      tax_amount: 36,
      total_amount: 276,
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('rpc_create_uom_purchase_order', {
      p_payload: input,
    })
  })

  it('propagates the server error for mapping at the UI boundary', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'PO_UOM_NOT_LEGAL_FOR_PURCHASE: line=2' },
    } as never)

    await expect(createAtomicUomPurchaseOrder(input)).rejects.toThrow(
      'PO_UOM_NOT_LEGAL_FOR_PURCHASE: line=2',
    )
  })

  it('rejects malformed successful responses', async () => {
    rpc.mockResolvedValue({
      data: { success: true, purchase_order_id: 'po-1' },
      error: null,
    } as never)

    await expect(createAtomicUomPurchaseOrder(input)).rejects.toThrow(
      'INVALID_PURCHASE_ORDER_RESPONSE_LINE_COUNT',
    )
  })

  it('maps canonical server and client validation codes to Arabic messages', () => {
    expect(mapPurchaseOrderError(new Error('PO_LINE_QUANTITY_MUST_BE_POSITIVE: line=1')))
      .toBe('يجب أن تكون كمية كل بند أكبر من صفر.')
    expect(mapPurchaseOrderError(new Error('PO_PRODUCT_NOT_MAPPED_OR_WRONG_ORG: line=2')))
      .toBe('أحد الأصناف غير مهيأ بوحدة قانونية أو لا يتبع المؤسسة.')
    expect(mapPurchaseOrderError(new Error('ORG_UNRESOLVED')))
      .toBe('تعذر تحديد المؤسسة الحالية.')
    expect(mapPurchaseOrderError(new Error('NOT_AUTHENTICATED')))
      .toBe('انتهت جلسة الدخول. سجّل الدخول ثم حاول مرة أخرى.')
    expect(mapPurchaseOrderError(new Error('unknown database detail')))
      .toBe('تعذر حفظ أمر الشراء. راجع البيانات وحاول مرة أخرى.')
  })
})
