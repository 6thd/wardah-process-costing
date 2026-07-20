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

export interface ProductWeightResult {
  success: boolean
  product_id: string
  quantity_entered: number
  uom_id: string
  base_quantity: number
  weight_uom_id: string
  net_weight: number
  gross_weight: number | null
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
    .eq('product_uom_conversions.is_active', true)
    .is('product_uom_conversions.valid_to', null)
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
  allowCrossDimension?: boolean
}): Promise<void> {
  if (!Number.isFinite(input.factorToBase) || input.factorToBase <= 0) {
    throw new Error('UOM_FACTOR_MUST_BE_POSITIVE')
  }

  const { data, error } = await supabase.rpc('rpc_set_product_uom_conversion', {
    p_org_id: input.orgId,
    p_product_id: input.productId,
    p_uom_id: input.uomId,
    p_factor_to_base: input.factorToBase,
    p_use_for_purchase: input.useForPurchase ?? false,
    p_use_for_sale: input.useForSale ?? false,
    p_barcode: input.barcode ?? null,
    p_notes: input.notes ?? null,
    p_allow_cross_dimension: input.allowCrossDimension ?? false,
  })

  if (error) throw error
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).success !== true) {
    throw new Error('UOM_CONVERSION_SAVE_FAILED')
  }
}

export async function setProductPhysicalWeight(input: {
  productId: string
  netWeight: number
  grossWeight?: number | null
  weightUomId: string
}): Promise<void> {
  if (!Number.isFinite(input.netWeight) || input.netWeight <= 0) {
    throw new Error('NET_WEIGHT_MUST_BE_POSITIVE')
  }
  if (input.grossWeight != null && input.grossWeight < input.netWeight) {
    throw new Error('GROSS_WEIGHT_BELOW_NET_WEIGHT')
  }
  const { data, error } = await supabase.rpc('rpc_set_product_physical_weight', {
    p_product_id: input.productId,
    p_net_weight: input.netWeight,
    p_gross_weight: input.grossWeight ?? null,
    p_weight_uom_id: input.weightUomId,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).success !== true) {
    throw new Error('PRODUCT_WEIGHT_SAVE_FAILED')
  }
}

export async function getProductWeight(input: {
  productId: string
  quantity: number
  uomId: string
  at?: string
}): Promise<ProductWeightResult> {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error('UOM_QUANTITY_MUST_BE_NONNEGATIVE')
  }
  const { data, error } = await supabase.rpc('rpc_get_product_weight', {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_uom_id: input.uomId,
    p_at: input.at ?? new Date().toISOString(),
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).success !== true) {
    throw new Error('PRODUCT_WEIGHT_LOOKUP_FAILED')
  }
  const result = data as Record<string, unknown>
  return {
    success: true,
    product_id: String(result.product_id),
    quantity_entered: numeric(result.quantity_entered as number | string),
    uom_id: String(result.uom_id),
    base_quantity: numeric(result.base_quantity as number | string),
    weight_uom_id: String(result.weight_uom_id),
    net_weight: numeric(result.net_weight as number | string),
    gross_weight: result.gross_weight == null ? null : numeric(result.gross_weight as number | string),
  }
}