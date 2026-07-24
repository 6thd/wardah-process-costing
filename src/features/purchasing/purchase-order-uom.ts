export interface PurchaseOrderUomLineInput {
  productId: string
  description?: string
  quantityEntered: number
  uomId: string
  factorToBase: number
  unitPriceEntered: number
  discountPercentage: number
  taxPercentage: number
}

export interface PurchaseOrderUomLinePayload {
  product_id: string
  description: string | null
  quantity: number
  qty_entered: number
  uom_id: string
  conversion_factor_snapshot: number
  unit_price: number
  unit_price_entered: number
  discount_percentage: number
  tax_percentage: number
}

export interface CommercialLineAmounts {
  gross: number
  discount: number
  subtotal: number
  tax: number
  total: number
}

function round6(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

export function buildPurchaseOrderUomLinePayload(
  line: PurchaseOrderUomLineInput,
): PurchaseOrderUomLinePayload {
  if (!line.productId) throw new Error('PO_LINE_PRODUCT_REQUIRED')
  if (!line.uomId) throw new Error('PO_LINE_UOM_REQUIRED')
  if (!Number.isFinite(line.quantityEntered) || line.quantityEntered <= 0) {
    throw new Error('PO_LINE_QUANTITY_MUST_BE_POSITIVE')
  }
  if (!Number.isFinite(line.factorToBase) || line.factorToBase <= 0) {
    throw new Error('UOM_FACTOR_MUST_BE_POSITIVE')
  }
  if (!Number.isFinite(line.unitPriceEntered) || line.unitPriceEntered < 0) {
    throw new Error('PO_LINE_PRICE_MUST_BE_NONNEGATIVE')
  }

  return {
    product_id: line.productId,
    description: line.description?.trim() || null,
    quantity: round6(line.quantityEntered * line.factorToBase),
    qty_entered: line.quantityEntered,
    uom_id: line.uomId,
    conversion_factor_snapshot: line.factorToBase,
    unit_price: round6(line.unitPriceEntered / line.factorToBase),
    unit_price_entered: line.unitPriceEntered,
    discount_percentage: line.discountPercentage,
    tax_percentage: line.taxPercentage,
  }
}

/**
 * Mirrors the database's authoritative line-level money policy:
 * gross, net, and tax-inclusive total are rounded per line to two decimals.
 * Header amounts are sums of these persisted line amounts.
 */
export function calculateCommercialLineAmounts(input: {
  quantityEntered: number
  unitPriceEntered: number
  discountPercentage: number
  taxPercentage: number
}): CommercialLineAmounts {
  const grossRaw = input.quantityEntered * input.unitPriceEntered
  const netRaw = grossRaw * (1 - input.discountPercentage / 100)
  const totalRaw = netRaw * (1 + input.taxPercentage / 100)

  const gross = roundMoney(grossRaw)
  const subtotal = roundMoney(netRaw)
  const total = roundMoney(totalRaw)

  return {
    gross,
    discount: roundMoney(gross - subtotal),
    subtotal,
    tax: roundMoney(total - subtotal),
    total,
  }
}

export function calculateCommercialLineTotal(input: {
  quantityEntered: number
  unitPriceEntered: number
  discountPercentage: number
  taxPercentage: number
}) {
  return calculateCommercialLineAmounts(input).total
}
