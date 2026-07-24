import { describe, expect, it } from 'vitest'
import {
  buildPurchaseOrderUomLinePayload,
  calculateCommercialLineTotal,
} from '../purchase-order-uom'

describe('purchase order UoM snapshots', () => {
  it('keeps base-unit entries at factor one', () => {
    const payload = buildPurchaseOrderUomLinePayload({
      productId: 'product-1',
      quantityEntered: 25,
      uomId: 'kg',
      factorToBase: 1,
      unitPriceEntered: 4.5,
      discountPercentage: 0,
      taxPercentage: 15,
    })

    expect(payload).toMatchObject({
      quantity: 25,
      qty_entered: 25,
      conversion_factor_snapshot: 1,
      unit_price: 4.5,
      unit_price_entered: 4.5,
    })
  })

  it('normalizes two tons to 2000 kilograms without changing commercial total', () => {
    const payload = buildPurchaseOrderUomLinePayload({
      productId: 'product-1',
      quantityEntered: 2,
      uomId: 'ton',
      factorToBase: 1000,
      unitPriceEntered: 3500,
      discountPercentage: 0,
      taxPercentage: 15,
    })

    expect(payload.quantity).toBe(2000)
    expect(payload.qty_entered).toBe(2)
    expect(payload.unit_price).toBe(3.5)
    expect(payload.unit_price_entered).toBe(3500)
    expect(payload.conversion_factor_snapshot).toBe(1000)
    expect(calculateCommercialLineTotal({
      quantityEntered: 2,
      unitPriceEntered: 3500,
      discountPercentage: 0,
      taxPercentage: 15,
    })).toBe(8050)
  })

  it.each([
    ['missing product', { productId: '', uomId: 'kg', quantityEntered: 1, factorToBase: 1, unitPriceEntered: 1 }],
    ['missing unit', { productId: 'p1', uomId: '', quantityEntered: 1, factorToBase: 1, unitPriceEntered: 1 }],
    ['zero quantity', { productId: 'p1', uomId: 'kg', quantityEntered: 0, factorToBase: 1, unitPriceEntered: 1 }],
    ['invalid factor', { productId: 'p1', uomId: 'kg', quantityEntered: 1, factorToBase: 0, unitPriceEntered: 1 }],
    ['negative price', { productId: 'p1', uomId: 'kg', quantityEntered: 1, factorToBase: 1, unitPriceEntered: -1 }],
  ])('rejects %s', (_label, invalid) => {
    expect(() => buildPurchaseOrderUomLinePayload({
      ...invalid,
      discountPercentage: 0,
      taxPercentage: 15,
    })).toThrow()
  })
})
