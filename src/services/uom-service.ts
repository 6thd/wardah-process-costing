import { supabase as _supabase } from '@/lib/supabase'

const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

export interface UomDefinition {
  id: string
  code: string
  name: string
  name_ar: string | null
  symbol: string
  category_id: string
  is_category_base: boolean
  is_product_specific: boolean
  decimal_places: number
}

export interface ProductUomOption extends UomDefinition {
  factor_to_base: number
  is_base: boolean
  use_for_purchase: boolean
  use_for_sale: boolean
  barcode: string | null
}

export interface ProductUomConversionResult {
  success: boolean
  product_id: string
  uom_id: string
  base_uom_id: string
  quantity_entered: number
  conversion_factor: number
  base_quantity: number
}

interface ProductUomRow {
  base_uom_id: string | null
  base_uom: UomDefinition | null
  conversions: Array<{
    factor_to_base: number | string
    use_for_purchase: boolean
    use_for_sale: boolean
    barcode: string | null
    uom: UomDefinition
  }> | null
}

function numeric(value: number | string | null | undefined): number {
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric UoM value: ${String(value)}`)
  return result
}

export async function getProductUomOptions(productId: string): Promise<ProductUomOption[]> {
  const { data, error } = await supabase
    .from('products')
    .select(`
      base_uom_id,
      base_uom:uoms!products_base_uom_id_fkey(
        id,code,name,name_ar,symbol,category_id,
        is_category_base,is_product_specific,decimal_places
      ),
      conversions:product_uom_conversions(
        factor_to_base,use_for_purchase,use_for_sale,barcode,
        uom:uoms(
          id,code,name,name_ar,symbol,category_id,
          is_category_base,is_product_specific,decimal_places
        )
      )
    `)
    .eq('id', productId)
    .single()

  if (error) throw error
  const row = data as unknown as ProductUomRow
  if (!row.base_uom_id || !row.base_uom) throw new Error('PRODUCT_BASE_UOM_REQUIRED')

  const base: ProductUomOption = {
    ...row.base_uom,
    factor_to_base: 1,
    is_base: true,
    use_for_purchase: true,
    use_for_sale: true,
    barcode: null,
  }
  const conversions = (row.conversions ?? []).map((conversion) => ({
    ...conversion.uom,
    factor_to_base: numeric(conversion.factor_to_base),
    is_base: false,
    use_for_purchase: conversion.use_for_purchase,
    use_for_sale: conversion.use_for_sale,
    barcode: conversion.barcode,
  }))

  return [base, ...conversions].sort((left, right) => {
    if (left.is_base !== right.is_base) return left.is_base ? -1 : 1
    return left.code.localeCompare(right.code)
  })
}

export async function convertProductQuantity(params: {
  productId: string
  quantity: number
  uomId: string
  at?: string
}): Promise<ProductUomConversionResult> {
  if (!Number.isFinite(params.quantity) || params.quantity < 0) {
    throw new Error('UOM_QUANTITY_MUST_BE_NONNEGATIVE')
  }
  const { data, error } = await supabase.rpc('rpc_convert_product_uom', {
    p_product_id: params.productId,
    p_quantity: params.quantity,
    p_uom_id: params.uomId,
    p_at: params.at ?? new Date().toISOString(),
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || !('success' in data)) {
    throw new Error('INVALID_UOM_CONVERSION_RESPONSE')
  }
  const result = data as Record<string, unknown>
  if (result.success !== true) throw new Error('UOM_CONVERSION_FAILED')
  return {
    success: true,
    product_id: String(result.product_id),
    uom_id: String(result.uom_id),
    base_uom_id: String(result.base_uom_id),
    quantity_entered: numeric(result.quantity_entered as number | string),
    conversion_factor: numeric(result.conversion_factor as number | string),
    base_quantity: numeric(result.base_quantity as number | string),
  }
}

export async function saveProductUomConversion(input: {
  orgId: string
  productId: string
  uomId: string
  factorToBase: number
  useForPurchase?: boolean
  useForSale?: boolean
  barcode?: string | null
  notes?: string | null
}): Promise<void> {
  if (!Number.isFinite(input.factorToBase) || input.factorToBase <= 0) {
    throw new Error('UOM_FACTOR_MUST_BE_POSITIVE')
  }
  const { error } = await supabase.from('product_uom_conversions').upsert({
    org_id: input.orgId,
    product_id: input.productId,
    uom_id: input.uomId,
    factor_to_base: input.factorToBase,
    use_for_purchase: input.useForPurchase ?? false,
    use_for_sale: input.useForSale ?? false,
    barcode: input.barcode ?? null,
    notes: input.notes ?? null,
    is_active: true,
    valid_to: null,
  }, { onConflict: 'org_id,product_id,uom_id' })
  if (error) throw error
}
