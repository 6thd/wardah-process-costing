import { supabase } from '@/lib/supabase'
import type { ProductUomOption } from '@/services/uom-service'
import type { Json } from '@/types/database.generated'

export interface PurchaseOrderVendorOption {
  id: string
  code: string | null
  name: string
}

export interface PurchaseOrderProductOption {
  id: string
  code: string
  name: string | null
  name_ar: string | null
  cost_price: number | null
  uom_migration_status: string
}

export interface PurchaseOrderFormOptions {
  vendors: PurchaseOrderVendorOption[]
  products: PurchaseOrderProductOption[]
}

export interface AtomicPurchaseOrderLineInput {
  product_id: string
  description?: string | null
  uom_id: string
  qty_entered: number
  unit_price_entered: number
  discount_percentage: number
  tax_percentage: number
}

export interface AtomicPurchaseOrderInput {
  org_id: string
  vendor_id: string
  order_date: string
  expected_delivery_date?: string | null
  notes?: string | null
  lines: AtomicPurchaseOrderLineInput[]
}

export interface AtomicPurchaseOrderResult {
  success: true
  purchase_order_id: string
  order_number: string
  line_count: number
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
}

function asFiniteNumber(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`INVALID_PURCHASE_ORDER_RESPONSE_${field}`)
  return parsed
}

export async function listUomPurchaseOrderOptions(orgId: string): Promise<PurchaseOrderFormOptions> {
  const { data, error } = await supabase.rpc('rpc_list_uom_purchase_order_options', {
    p_org_id: orgId,
  })

  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object') throw new Error('INVALID_PURCHASE_ORDER_OPTIONS_RESPONSE')

  const result = data as Record<string, unknown>
  if (!Array.isArray(result.vendors) || !Array.isArray(result.products)) {
    throw new Error('INVALID_PURCHASE_ORDER_OPTIONS_RESPONSE')
  }

  return {
    vendors: result.vendors as PurchaseOrderVendorOption[],
    products: result.products as PurchaseOrderProductOption[],
  }
}

export async function listPurchaseProductUoms(
  orgId: string,
  productId: string,
): Promise<ProductUomOption[]> {
  const { data, error } = await supabase.rpc('rpc_get_purchase_product_uoms', {
    p_org_id: orgId,
    p_product_id: productId,
  })

  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) throw new Error('INVALID_PURCHASE_PRODUCT_UOMS_RESPONSE')
  return data as ProductUomOption[]
}

export async function createAtomicUomPurchaseOrder(
  input: AtomicPurchaseOrderInput,
): Promise<AtomicPurchaseOrderResult> {
  const { data, error } = await supabase.rpc('rpc_create_uom_purchase_order', {
    p_payload: input as unknown as Json,
  })

  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object') throw new Error('INVALID_PURCHASE_ORDER_RESPONSE')

  const result = data as Record<string, unknown>
  if (result.success !== true) throw new Error('PURCHASE_ORDER_CREATION_FAILED')

  return {
    success: true,
    purchase_order_id: String(result.purchase_order_id),
    order_number: String(result.order_number),
    line_count: asFiniteNumber(result.line_count, 'LINE_COUNT'),
    subtotal: asFiniteNumber(result.subtotal, 'SUBTOTAL'),
    discount_amount: asFiniteNumber(result.discount_amount, 'DISCOUNT'),
    tax_amount: asFiniteNumber(result.tax_amount, 'TAX'),
    total_amount: asFiniteNumber(result.total_amount, 'TOTAL'),
  }
}

const PURCHASE_ORDER_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  PO_PAYLOAD_OBJECT_REQUIRED: 'بيانات أمر الشراء غير صالحة.',
  ORG_UNRESOLVED: 'تعذر تحديد المؤسسة الحالية.',
  NOT_AUTHENTICATED: 'انتهت جلسة الدخول. سجّل الدخول ثم حاول مرة أخرى.',
  NOT_ORG_MEMBER: 'ليس لديك صلاحية على المؤسسة الحالية.',
  UOM_ENGINE_NOT_ENABLED_FOR_ORG: 'محرك وحدات القياس غير مفعّل للمؤسسة الحالية.',
  VENDOR_NOT_FOUND_OR_WRONG_ORG: 'المورد غير موجود أو لا يتبع المؤسسة الحالية.',
  EXPECTED_DELIVERY_BEFORE_ORDER_DATE: 'تاريخ التسليم المتوقع لا يمكن أن يسبق تاريخ أمر الشراء.',
  PO_LINES_ARRAY_REQUIRED: 'صيغة بنود أمر الشراء غير صالحة.',
  PO_REQUIRES_LINES: 'أضف صنفًا واحدًا على الأقل.',
  PO_LINE_LIMIT_EXCEEDED: 'عدد بنود أمر الشراء يتجاوز الحد المسموح.',
  PO_LINE_OBJECT_REQUIRED: 'يوجد بند بصيغة غير صالحة.',
  PO_PRODUCT_NOT_MAPPED_OR_WRONG_ORG: 'أحد الأصناف غير مهيأ بوحدة قانونية أو لا يتبع المؤسسة.',
  PO_UOM_NOT_LEGAL_FOR_PURCHASE: 'إحدى الوحدات غير مسموحة للشراء لهذا الصنف.',
  PO_LINE_QUANTITY_MUST_BE_POSITIVE: 'يجب أن تكون كمية كل بند أكبر من صفر.',
  PO_LINE_PRICE_MUST_BE_NONNEGATIVE: 'سعر البند لا يمكن أن يكون سالبًا.',
  PO_LINE_DISCOUNT_OUT_OF_RANGE: 'نسبة الخصم يجب أن تكون بين 0 و100.',
  PO_LINE_TAX_OUT_OF_RANGE: 'نسبة الضريبة يجب أن تكون بين 0 و100.',
}

export function mapPurchaseOrderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const code = Object.keys(PURCHASE_ORDER_ERROR_MESSAGES).find((candidate) => raw.includes(candidate))
  return code ? PURCHASE_ORDER_ERROR_MESSAGES[code] : 'تعذر حفظ أمر الشراء. راجع البيانات وحاول مرة أخرى.'
}
