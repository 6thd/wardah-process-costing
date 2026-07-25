import { describe, expect, it } from 'vitest'
import {
  buildGoodsReceiptLine,
  createReceiptDraftLine,
  validateReceiptQuantity,
  type ReceivablePurchaseOrderLine,
} from '@/services/uom-goods-receipt-service'

const tonneLine: ReceivablePurchaseOrderLine = {
  id: 'po-line-1',
  line_number: 1,
  product_id: 'product-1',
  product: {
    code: 'RM-010',
    name: 'PP Clear Sheet',
    name_ar: 'رول شفاف',
  },
  uom_id: 'uom-tonne',
  uom: {
    id: 'uom-tonne',
    code: 'TON',
    name: 'Tonne',
    name_ar: 'طن',
    symbol: 'طن',
    decimal_places: 3,
  },
  conversion_factor_snapshot: 1000,
  ordered_qty_entered: 0.5,
  ordered_qty_base: 500,
  received_qty_entered: 0,
  received_qty_base: 0,
  accepted_qty_base: 0,
  rejected_qty_base: 0,
  pending_qty_base: 0,
  remaining_qty_entered: 0.5,
  remaining_qty_base: 500,
  unit_cost_entered: 2000,
  unit_cost_base: 2,
}

describe('UoM goods receipt contract', () => {
  it('defaults a new draft line to the open entered-unit balance', () => {
    const draft = createReceiptDraftLine(tonneLine)

    expect(draft.is_selected).toBe(true)
    expect(draft.receipt_qty_entered).toBe(0.5)
    expect(draft.quality_status).toBe('accepted')
  })

  it('builds a partial payload in entered units and preserves the PO snapshots', () => {
    const draft = {
      ...createReceiptDraftLine(tonneLine),
      receipt_qty_entered: 0.25,
    }

    const payload = buildGoodsReceiptLine(draft)

    expect(payload.qty_entered).toBe(0.25)
    expect(payload.received_quantity).toBe(250)
    expect(payload.uom_id).toBe('uom-tonne')
    expect(payload.unit_cost_entered).toBe(2000)
    expect(payload.unit_cost).toBe(2)
    expect(payload.quality_status).toBe('accepted')
  })

  it('allows a rejected quantity only within the same open balance', () => {
    const draft = {
      ...createReceiptDraftLine(tonneLine),
      receipt_qty_entered: 0.25,
      quality_status: 'rejected' as const,
    }

    expect(buildGoodsReceiptLine(draft).quality_status).toBe('rejected')
  })

  it('fails closed when the entered quantity exceeds the open balance', () => {
    expect(() => validateReceiptQuantity(0.500002, 0.5)).toThrow(
      'RECEIPT_QUANTITY_EXCEEDS_OPEN_BALANCE',
    )
  })

  it('rejects zero, negative, and non-finite quantities', () => {
    expect(() => validateReceiptQuantity(0, 0.5)).toThrow('RECEIPT_QUANTITY_MUST_BE_POSITIVE')
    expect(() => validateReceiptQuantity(-1, 0.5)).toThrow('RECEIPT_QUANTITY_MUST_BE_POSITIVE')
    expect(() => validateReceiptQuantity(Number.NaN, 0.5)).toThrow(
      'RECEIPT_QUANTITY_MUST_BE_POSITIVE',
    )
  })
})
