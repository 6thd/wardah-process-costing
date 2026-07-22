import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database.generated'
import type { UomDefinition } from '@/services/uom-service'

export interface UomCategoryDefinition {
  id: string
  code: string
  name: string
  name_ar: string | null
  dimension: string
  is_system: boolean
}

export interface UomCatalog {
  categories: UomCategoryDefinition[]
  uoms: UomDefinition[]
}

export interface ProductUomConversionProfile {
  id: string
  uom: UomDefinition
  factor_to_base: number
  use_for_purchase: boolean
  use_for_sale: boolean
  barcode: string | null
  notes: string | null
  allow_cross_dimension: boolean
  valid_from: string
}

export interface ProductUomMasterProfile {
  product_id: string
  org_id: string
  base_uom_id: string | null
  base_uom: UomDefinition | null
  uom_migration_status: string
  net_weight: number | null
  gross_weight: number | null
  weight_uom_id: string | null
  weight_uom: UomDefinition | null
  conversions: ProductUomConversionProfile[]
}

export interface ProductBaseUomChangeGuard {
  has_movements: boolean
  base_uom_locked: boolean
}

export interface UomBackfillIssue {
  id: string
  org_id: string
  source_table: string
  source_id: string | null
  source_value: string | null
  issue_code: string
  details: Json
  status: string
  resolved_uom_id: string | null
  created_at: string
}

const UOM_SELECT = [
  'id',
  'code',
  'name',
  'name_ar',
  'symbol',
  'category_id',
  'is_category_base',
  'is_product_specific',
  'decimal_places',
].join(',')

function numeric(value: number | string | null | undefined): number {
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric UoM value: ${String(value)}`)
  return result
}

function nullableNumeric(value: number | string | null | undefined): number | null {
  return value == null ? null : numeric(value)
}

export async function listUomCatalog(): Promise<UomCatalog> {
  const { data: categories, error: categoriesError } = await supabase
    .from('uom_categories')
    .select('id,code,name,name_ar,dimension,is_system')
    .order('dimension')
    .order('code')

  if (categoriesError) throw categoriesError

  const { data: uoms, error: uomsError } = await supabase
    .from('uoms')
    .select(UOM_SELECT)
    .eq('is_active', true)
    .order('code')

  if (uomsError) throw uomsError

  return {
    categories: categories ?? [],
    uoms: (uoms ?? []) as unknown as UomDefinition[],
  }
}

export async function getProductUomMasterProfile(
  orgId: string,
  productId: string,
): Promise<ProductUomMasterProfile> {
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id,org_id,base_uom_id,uom_migration_status,net_weight,gross_weight,weight_uom_id')
    .eq('org_id', orgId)
    .eq('id', productId)
    .single()

  if (productError) throw productError
  if (!product) throw new Error('PRODUCT_NOT_FOUND_OR_WRONG_ORG')

  const { data: conversions, error: conversionsError } = await supabase
    .from('product_uom_conversions')
    .select('id,uom_id,factor_to_base,use_for_purchase,use_for_sale,barcode,notes,allow_cross_dimension,valid_from')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('is_active', true)
    .is('valid_to', null)
    .order('valid_from', { ascending: false })

  if (conversionsError) throw conversionsError

  const uomIds = Array.from(new Set([
    product.base_uom_id,
    product.weight_uom_id,
    ...(conversions ?? []).map((conversion) => conversion.uom_id),
  ].filter((value): value is string => Boolean(value))))

  let uoms: UomDefinition[] = []
  if (uomIds.length > 0) {
    const { data: uomRows, error: uomsError } = await supabase
      .from('uoms')
      .select(UOM_SELECT)
      .in('id', uomIds)

    if (uomsError) throw uomsError
    uoms = (uomRows ?? []) as unknown as UomDefinition[]
  }

  const uomById = new Map(uoms.map((uom) => [uom.id, uom]))
  const baseUom = product.base_uom_id ? uomById.get(product.base_uom_id) ?? null : null
  const weightUom = product.weight_uom_id ? uomById.get(product.weight_uom_id) ?? null : null

  if (product.base_uom_id && !baseUom) throw new Error('PRODUCT_BASE_UOM_INVALID')
  if (product.weight_uom_id && !weightUom) throw new Error('PRODUCT_WEIGHT_UOM_INVALID')

  const mappedConversions = (conversions ?? []).map((conversion) => {
    const uom = uomById.get(conversion.uom_id)
    if (!uom) throw new Error('PRODUCT_UOM_CONVERSION_TARGET_INVALID')

    return {
      id: conversion.id,
      uom,
      factor_to_base: numeric(conversion.factor_to_base),
      use_for_purchase: conversion.use_for_purchase,
      use_for_sale: conversion.use_for_sale,
      barcode: conversion.barcode,
      notes: conversion.notes,
      allow_cross_dimension: conversion.allow_cross_dimension,
      valid_from: conversion.valid_from,
    }
  })

  return {
    product_id: product.id,
    org_id: product.org_id,
    base_uom_id: product.base_uom_id,
    base_uom: baseUom,
    uom_migration_status: product.uom_migration_status,
    net_weight: nullableNumeric(product.net_weight),
    gross_weight: nullableNumeric(product.gross_weight),
    weight_uom_id: product.weight_uom_id,
    weight_uom: weightUom,
    conversions: mappedConversions,
  }
}

export async function getProductBaseUomChangeGuard(
  orgId: string,
  productId: string,
): Promise<ProductBaseUomChangeGuard> {
  const { data, error } = await supabase
    .from('stock_ledger_entries')
    .select('id')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .limit(1)
    .maybeSingle()

  if (error) throw error

  const hasMovements = Boolean(data)
  return {
    has_movements: hasMovements,
    base_uom_locked: hasMovements,
  }
}

export async function listOpenUomBackfillIssues(orgId: string): Promise<UomBackfillIssue[]> {
  const { data, error } = await supabase
    .from('uom_backfill_issues')
    .select('id,org_id,source_table,source_id,source_value,issue_code,details,status,resolved_uom_id,created_at')
    .eq('org_id', orgId)
    .eq('status', 'OPEN')
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map((issue) => ({
    ...issue,
    org_id: issue.org_id as string,
  }))
}
