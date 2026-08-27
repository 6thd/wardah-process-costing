import { describe, expect, it, vi } from 'vitest'
import {
  candidateToMatchedLine,
  stableOperationIdentity,
  type SupplierInvoiceCandidate,
} from '../supplier-invoice-atomic-service'

const candidate: SupplierInvoiceCandidate = {
  organization_id: 'org-1',
  vendor_id: 'vendor-1',
  vendor: { id: 'vendor-1', code: 'V1', name: 'Vendor One' },
  purchase_order_id: 'po-1',
  purchase_order_number: 'PO-1',
  purchase_order_status: 'fully_received',
  purchase_order_line_id: 'pol-1',
  goods_receipt_id: 'gr-1',
  goods_receipt_number: 'GR-1',
  goods_receipt_status: 'posted',
  goods_receipt_line_id: 'grl-1',
  quality_status: 'accepted',
  product_id: 'product-1',
  product: { id: 'product-1', code: 'P1', name: 'Product One', name_ar: null },
  uom_id: 'uom-1',
  uom: { id: 'uom-1', code: 'KG', name: 'Kilogram', name_ar: 'كيلوجرام', symbol: 'kg', decimal_places: 3 },
  conversion_factor_snapshot: 2,
  accepted_qty_base: 20,
  accepted_qty_entered: 10,
  allocated_qty_base: 6,
  allocated_qty_entered: 3,
  remaining_qty_base: 14,
  remaining_qty_entered: 7,
  po_unit_price_base: 4.75,
  po_unit_price_entered: 9.5,
  discount_percentage: 2,
  tax_percentage: 15,
}

describe('supplier-invoice-atomic-service helpers', () => {
  it('builds the matched write line exclusively from persisted candidate snapshots', () => {
    expect(candidateToMatchedLine(candidate)).toEqual({
      goods_receipt_line_id: 'grl-1',
      quantity_base: 14,
      unit_price: 4.75,
      discount_percentage: 2,
      tax_percentage: 15,
    })
  })

  it('reuses one operation key for an unchanged logical request', () => {
    const factory = vi.fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')

    const first = stableOperationIdentity('same-request', null, factory)
    const retry = stableOperationIdentity('same-request', first, factory)

    expect(first).toEqual({ fingerprint: 'same-request', key: 'key-1' })
    expect(retry).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('rotates the key when the logical request changes', () => {
    const factory = vi.fn()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')

    const first = stableOperationIdentity('request-a', null, factory)
    const changed = stableOperationIdentity('request-b', first, factory)

    expect(changed).toEqual({ fingerprint: 'request-b', key: 'key-2' })
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
