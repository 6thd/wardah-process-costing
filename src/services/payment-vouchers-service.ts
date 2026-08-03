/**
 * Payment Vouchers Service
 * خدمة سندات القبض والصرف الاحترافية
 * 
 * Features:
 * - Customer Receipts (سندات القبض)
 * - Supplier Payments (سندات الصرف)
 * - Multi-invoice allocation
 * - Automatic accounting entries
 * - Payment methods support
 */

import { supabase as _supabase, getEffectiveTenantId } from '@/lib/supabase'
const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

// ========================================
// Types & Interfaces
// ========================================

export type PaymentMethod = 
  | 'cash' 
  | 'bank_transfer' 
  | 'check' 
  | 'credit_card' 
  | 'debit_card'
  | 'online_payment'
  | 'mobile_payment'
  | 'other'

export type VoucherStatus = 'draft' | 'posted' | 'cancelled'

export interface CustomerReceipt {
  id?: string
  org_id?: string
  receipt_number: string
  customer_id: string
  receipt_date: string
  amount: number
  payment_method: PaymentMethod
  payment_account_id?: string // GL account for cash/bank
  check_number?: string
  check_date?: string
  check_bank?: string
  reference_number?: string
  notes?: string
  status: VoucherStatus
  gl_entry_id?: string
  created_by?: string
  posted_at?: string
  posted_by?: string
  lines?: CustomerReceiptLine[]
  // Joined fields
  customer?: {
    id: string
    name: string
    name_ar?: string
  }
}

export interface CustomerReceiptLine {
  id?: string
  receipt_id?: string
  invoice_id: string
  allocated_amount: number
  discount_amount?: number
  notes?: string
}

export interface SupplierPayment {
  id?: string
  org_id?: string
  payment_number: string
  vendor_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod
  payment_account_id?: string // GL account for cash/bank
  check_number?: string
  check_date?: string
  check_bank?: string
  reference_number?: string
  notes?: string
  status: VoucherStatus
  gl_entry_id?: string
  created_by?: string
  posted_at?: string
  posted_by?: string
  lines?: SupplierPaymentLine[]
  // Joined fields
  vendor?: {
    id: string
    name: string
    name_ar?: string
  }
}

export interface SupplierPaymentLine {
  id?: string
  payment_id?: string
  invoice_id: string
  allocated_amount: number
  discount_amount?: number
  notes?: string
}

// ========================================
// RPC contract helpers (Migration 168)
// ========================================

/**
 * Voucher creation, draft editing and cancellation are owned by the atomic RPCs
 * added in Migration 168. The header, the allocation lines and the voucher
 * number are written inside a single server transaction, so the client never
 * inserts a header and then compensates for a failed line insert.
 */
const VOUCHER_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'يجب تسجيل الدخول',
  TENANT_MEMBERSHIP_REQUIRED: 'لا تملك عضوية نشطة في هذه المؤسسة',
  VOUCHER_AMOUNT_INVALID: 'المبلغ يجب أن يكون أكبر من الصفر',
  VOUCHER_PAYMENT_ACCOUNT_REQUIRED: 'اختر حساب السداد',
  VOUCHER_DISCOUNT_UNSUPPORTED: 'الخصم غير مدعوم في التخصيص',
  VOUCHER_UPDATE_LINES_REQUIRED: 'أرسل مجموعة التخصيصات كاملة عند التعديل',
  VOUCHER_CANCEL_REASON_REQUIRED: 'سبب الإلغاء مطلوب',
  VOUCHER_CANCEL_PERMISSION_REQUIRED: 'لا تملك صلاحية إلغاء السندات',
  VOUCHER_CANCEL_REQUIRES_RESET: 'أعد السند إلى مسودة قبل إلغائه',
  VOUCHER_UNPOST_REASON_REQUIRED: 'سبب الإعادة إلى مسودة مطلوب (5 أحرف على الأقل)',
  VOUCHER_UNPOST_PERMISSION_REQUIRED: 'لا تملك صلاحية إعادة السندات إلى مسودة',
  VOUCHER_PAYMENT_ACCOUNT_INVALID_OR_CROSS_ORG:
    'حساب السداد غير صالح — يجب أن يكون حسابًا نشطًا يقبل الترحيل في هذه المؤسسة',
  VOUCHER_PAYMENT_ACCOUNT_METHOD_MISMATCH: 'حساب السداد لا يتوافق مع طريقة السداد المختارة',
  CUSTOMER_RECEIPT_NOT_POSTED: 'السند ليس مرحّلًا',
  SUPPLIER_PAYMENT_NOT_POSTED: 'السند ليس مرحّلًا',
  CUSTOMER_RECEIPT_UNPOST_INVOICE_DRIFT: 'رصيد الفاتورة تغيّر منذ الترحيل — راجع الفاتورة قبل الإعادة',
  SUPPLIER_PAYMENT_UNPOST_INVOICE_DRIFT: 'رصيد الفاتورة تغيّر منذ الترحيل — راجع الفاتورة قبل الإعادة',
  PERIOD_CLOSED: 'الفترة المحاسبية مغلقة',
  POSTED_ENTRY_IMMUTABLE: 'القيد المرحّل غير قابل للتعديل',
  CUSTOMER_RECEIPT_CUSTOMER_REQUIRED: 'اختر العميل',
  CUSTOMER_RECEIPT_CUSTOMER_CROSS_ORG: 'العميل لا يتبع هذه المؤسسة',
  CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG: 'السند غير موجود في هذه المؤسسة',
  CUSTOMER_RECEIPT_NOT_DRAFT: 'لا يمكن تعديل سند غير مسودة',
  CUSTOMER_RECEIPT_NOT_CANCELLABLE: 'حالة السند لا تسمح بالإلغاء',
  CUSTOMER_RECEIPT_PARTY_IMMUTABLE: 'لا يمكن تغيير العميل — ألغِ السند وأنشئ سندًا جديدًا',
  CUSTOMER_RECEIPT_CORRECTION_UNPROVEN: 'السند لم يمر بدورة إعادة التصحيح',
  CUSTOMER_RECEIPT_CANCEL_UNPROVEN: 'السند لم يمر بدورة إعادة التصحيح',
  CUSTOMER_RECEIPT_ALLOCATION_INVOICE_REQUIRED: 'اختر الفاتورة في كل سطر تخصيص',
  CUSTOMER_RECEIPT_ALLOCATION_AMOUNT_INVALID: 'مبلغ التخصيص يجب أن يكون أكبر من الصفر',
  CUSTOMER_RECEIPT_ALLOCATION_DUPLICATE_INVOICE: 'لا يمكن تخصيص الفاتورة نفسها مرتين',
  CUSTOMER_RECEIPT_ALLOCATION_CROSS_SCOPE: 'الفاتورة لا تتبع هذا العميل أو هذه المؤسسة',
  CUSTOMER_RECEIPT_ALLOCATION_TOTAL_MISMATCH: 'مجموع البنود لا يساوي المبلغ الإجمالي',
  CUSTOMER_RECEIPT_OVER_ALLOCATION: 'التخصيص يتجاوز الرصيد المفتوح للفاتورة',
  SUPPLIER_PAYMENT_VENDOR_REQUIRED: 'اختر المورد',
  SUPPLIER_PAYMENT_VENDOR_CROSS_ORG: 'المورد لا يتبع هذه المؤسسة',
  SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG: 'السند غير موجود في هذه المؤسسة',
  SUPPLIER_PAYMENT_NOT_DRAFT: 'لا يمكن تعديل سند غير مسودة',
  SUPPLIER_PAYMENT_NOT_CANCELLABLE: 'حالة السند لا تسمح بالإلغاء',
  SUPPLIER_PAYMENT_PARTY_IMMUTABLE: 'لا يمكن تغيير المورد — ألغِ السند وأنشئ سندًا جديدًا',
  SUPPLIER_PAYMENT_CORRECTION_UNPROVEN: 'السند لم يمر بدورة إعادة التصحيح',
  SUPPLIER_PAYMENT_CANCEL_UNPROVEN: 'السند لم يمر بدورة إعادة التصحيح',
  SUPPLIER_PAYMENT_ALLOCATION_INVOICE_REQUIRED: 'اختر الفاتورة في كل سطر تخصيص',
  SUPPLIER_PAYMENT_ALLOCATION_AMOUNT_INVALID: 'مبلغ التخصيص يجب أن يكون أكبر من الصفر',
  SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE_INVOICE: 'لا يمكن تخصيص الفاتورة نفسها مرتين',
  SUPPLIER_PAYMENT_ALLOCATION_CROSS_SCOPE: 'الفاتورة لا تتبع هذا المورد أو هذه المؤسسة',
  SUPPLIER_PAYMENT_ALLOCATION_TOTAL_MISMATCH: 'مجموع البنود لا يساوي المبلغ الإجمالي',
  SUPPLIER_PAYMENT_OVER_ALLOCATION: 'التخصيص يتجاوز الرصيد المفتوح للفاتورة',
  SUPPLIER_INVOICE_NOT_PAYABLE: 'فاتورة المورد غير قابلة للسداد في حالتها الحالية'
}

/**
 * The RPCs raise `CODE: context` so the code stays machine-readable while the
 * context stays available for diagnosis. Keep both: the Arabic sentence for the
 * user, the raw code for logs and support.
 */
export function describeVoucherError(error: unknown): string {
  const raw =
    typeof error === 'string'
      ? error
      : ((error as { message?: string } | null)?.message ?? String(error))

  const code = raw.match(/[A-Z][A-Z0-9_]{3,}/)?.[0]
  const message = code ? VOUCHER_ERROR_MESSAGES[code] : undefined

  if (!message) return raw
  return code && raw.includes(':') ? `${message} (${raw})` : message
}

/** Allocation lines as the RPC payload expects them. */
function toAllocationPayload(
  lines?: Array<CustomerReceiptLine | SupplierPaymentLine>
): Array<Record<string, unknown>> {
  return (lines ?? []).map(line => ({
    invoice_id: line.invoice_id,
    allocated_amount: line.allocated_amount,
    discount_amount: line.discount_amount ?? 0,
    notes: line.notes ?? null
  }))
}

/**
 * Client-side pre-checks. These are convenience only — every one of them is
 * enforced again inside the RPC, which is the authority.
 */
function assertVoucherAmounts(
  amount: number,
  lines?: Array<CustomerReceiptLine | SupplierPaymentLine>
): void {
  if (amount <= 0) {
    throw new Error('المبلغ يجب أن يكون أكبر من الصفر')
  }
  if (lines && lines.length > 0) {
    const linesTotal = lines.reduce(
      (sum, line) => sum + line.allocated_amount - (line.discount_amount || 0),
      0
    )
    if (Math.abs(linesTotal - amount) > 0.01) {
      throw new Error('مجموع البنود لا يساوي المبلغ الإجمالي')
    }
  }
}

// ========================================
// Customer Receipts Functions
// ========================================

/**
 * Create customer receipt (سند قبض)
 *
 * Header, allocation lines and the voucher number are written by
 * `rpc_create_customer_receipt` in one transaction. The number comes from
 * `wardah_next_voucher_number` under an advisory lock, so two concurrent
 * creations can no longer receive the same number.
 */
export async function createCustomerReceipt(
  receipt: Omit<CustomerReceipt, 'id' | 'receipt_number' | 'status'>
): Promise<{ success: boolean; data?: CustomerReceipt; error?: any }> {
  try {
    assertVoucherAmounts(receipt.amount, receipt.lines)

    const { data, error } = await supabase.rpc('rpc_create_customer_receipt', {
      p_payload: {
        customer_id: receipt.customer_id,
        receipt_date: receipt.receipt_date,
        amount: receipt.amount,
        payment_method: receipt.payment_method,
        payment_account_id: receipt.payment_account_id ?? null,
        check_number: receipt.check_number ?? null,
        check_date: receipt.check_date || null,
        reference_number: receipt.reference_number ?? null,
        notes: receipt.notes ?? null,
        lines: toAllocationPayload(receipt.lines)
      }
    })

    if (error) throw error
    if (!data?.success) throw new Error('Customer receipt creation failed')

    return {
      success: true,
      data: {
        id: data.receipt_id,
        receipt_number: data.receipt_number,
        customer_id: receipt.customer_id,
        receipt_date: receipt.receipt_date,
        amount: receipt.amount,
        payment_method: receipt.payment_method,
        status: data.status as VoucherStatus,
        lines: receipt.lines
      }
    }
  } catch (error: any) {
    console.error('Error creating customer receipt:', error)
    return { success: false, error: describeVoucherError(error) }
  }
}

/**
 * Replace the allocation set of a draft customer receipt (تعديل مسودة سند قبض)
 *
 * The replacement is explicit: `lines` must always be sent, even when empty.
 * A receipt that carries a GL identity is only editable when a trusted reset
 * record from Migration 166 proves it reached the correction phase legally.
 */
export async function updateCustomerReceiptDraft(
  receiptId: string,
  changes: Partial<Pick<CustomerReceipt,
    'receipt_date' | 'amount' | 'payment_method' | 'payment_account_id' |
    'check_number' | 'check_date' | 'reference_number' | 'notes'>> & {
    lines: CustomerReceiptLine[]
  }
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    if (changes.amount !== undefined) {
      assertVoucherAmounts(changes.amount, changes.lines)
    }

    const { data, error } = await supabase.rpc('rpc_update_customer_receipt_draft', {
      p_receipt_id: receiptId,
      p_payload: {
        receipt_date: changes.receipt_date ?? null,
        amount: changes.amount ?? null,
        payment_method: changes.payment_method ?? null,
        payment_account_id: changes.payment_account_id ?? null,
        check_number: changes.check_number ?? null,
        check_date: changes.check_date || null,
        reference_number: changes.reference_number ?? null,
        notes: changes.notes ?? null,
        lines: toAllocationPayload(changes.lines)
      }
    })

    if (error) throw error
    if (!data?.success) throw new Error('Customer receipt update failed')

    return { success: true, data }
  } catch (error: any) {
    console.error('Error updating customer receipt draft:', error)
    return { success: false, error: describeVoucherError(error) }
  }
}

/**
 * Cancel a customer receipt (إلغاء سند قبض)
 *
 * A posted receipt is refused: it must go through `rpc_reset_customer_receipt_to_draft`
 * first, so the reversal stays owned by the Migration 166 function. Cancelling an
 * already-cancelled receipt is idempotent and returns `duplicate: true`.
 */
export async function cancelCustomerReceipt(
  receiptId: string,
  reason: string
): Promise<{ success: boolean; data?: any; duplicate?: boolean; error?: any }> {
  try {
    const { data, error } = await supabase.rpc('rpc_cancel_customer_receipt', {
      p_receipt_id: receiptId,
      p_reason: reason
    })

    if (error) throw error
    if (!data?.success) throw new Error('Customer receipt cancellation failed')

    return { success: true, data, duplicate: Boolean(data.duplicate) }
  } catch (error: any) {
    console.error('Error cancelling customer receipt:', error)
    return { success: false, error: describeVoucherError(error) }
  }
}

/**
 * Validate receipt status before posting
 */
function validateReceiptStatus(receipt: any): void {
  if (receipt.status === 'posted') {
    throw new Error('السند مقرر مسبقاً')
  }
  if (receipt.status === 'cancelled') {
    throw new Error('لا يمكن إقرار سند ملغي')
  }
}

/**
 * Post customer receipt (إقرار سند القبض)
 */
export async function postCustomerReceipt(
  receiptId: string
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await supabase.rpc('rpc_post_customer_receipt', {
      p_receipt_id: receiptId
    })
    if (error) throw error
    if (!data?.success) throw new Error('Customer receipt posting failed')
    return { success: true, data }
  } catch (error: any) {
    console.error('Error posting customer receipt:', error)
    return { success: false, error: error.message || error }
  }
}

/**
 * Return a posted customer receipt to draft for correction (إعادة إلى مسودة)
 *
 * Owned by `rpc_reset_customer_receipt_to_draft` from Migration 166: it unwinds
 * the allocated amounts on each invoice and moves the GL entry back to draft
 * while keeping `entry_number` and every GL line. The audit record it writes is
 * what later authorizes editing or cancelling the corrected voucher — nothing
 * else counts as proof the voucher reached the correction phase.
 */
type VoucherResetResult = { success: boolean; data?: any; duplicate?: boolean; error?: any }

async function resetVoucherToDraft(
  rpcName: 'rpc_reset_customer_receipt_to_draft' | 'rpc_reset_supplier_payment_to_draft',
  idParameter: 'p_receipt_id' | 'p_payment_id',
  voucherId: string,
  reason: string,
  failureMessage: string
): Promise<VoucherResetResult> {
  try {
    const parameters = { [idParameter]: voucherId, p_reason: reason }
    const { data, error } = await supabase.rpc(rpcName, parameters)

    if (error) throw error
    if (!data?.success) throw new Error(failureMessage)

    return { success: true, data, duplicate: Boolean(data.duplicate) }
  } catch (error: any) {
    console.error(`${failureMessage}:`, error)
    return { success: false, error: describeVoucherError(error) }
  }
}

export async function resetCustomerReceiptToDraft(
  receiptId: string,
  reason: string
): Promise<VoucherResetResult> {
  return resetVoucherToDraft(
    'rpc_reset_customer_receipt_to_draft',
    'p_receipt_id',
    receiptId,
    reason,
    'Customer receipt reset failed'
  )
}

/**
 * Get all customer receipts
 */
export async function getAllCustomerReceipts(filters?: {
  customer_id?: string
  from_date?: string
  to_date?: string
  status?: VoucherStatus
}): Promise<{ success: boolean; data?: CustomerReceipt[]; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId()

    let query = supabase
      .from('customer_collections')
      .select(`
        *,
        customer:customers(*),
        lines:customer_collection_lines(
          *,
          invoice:sales_invoices(*)
        )
      `)
      .order('collection_date', { ascending: false })

    if (tenantId) {
      query = query.eq('org_id', tenantId)
    }

    if (filters?.customer_id) {
      query = query.eq('customer_id', filters.customer_id)
    }

    if (filters?.from_date) {
      query = query.gte('collection_date', filters.from_date)
    }

    if (filters?.to_date) {
      query = query.lte('collection_date', filters.to_date)
    }

    if (filters?.status) {
      query = query.eq('status', filters.status)
    }

    const { data, error } = await query

    if (error) throw error

    return {
      success: true,
      data: data?.map((r: any) => ({
        ...r,
        receipt_number: r.collection_number
      })) || []
    }
  } catch (error: any) {
    console.error('Error fetching customer receipts:', error)
    return { success: false, error: error.message || error }
  }
}

// ========================================
// Supplier Payments Functions
// ========================================

/**
 * Create supplier payment (سند صرف)
 *
 * Header, allocation lines and the voucher number are written by
 * `rpc_create_supplier_payment` in one transaction. The RPC also refuses
 * allocations against a supplier invoice that is not payable in its current
 * status.
 */
export async function createSupplierPayment(
  payment: Omit<SupplierPayment, 'id' | 'payment_number' | 'status'>
): Promise<{ success: boolean; data?: SupplierPayment; error?: any }> {
  try {
    assertVoucherAmounts(payment.amount, payment.lines)

    const { data, error } = await supabase.rpc('rpc_create_supplier_payment', {
      p_payload: {
        vendor_id: payment.vendor_id,
        payment_date: payment.payment_date,
        amount: payment.amount,
        payment_method: payment.payment_method,
        payment_account_id: payment.payment_account_id ?? null,
        check_number: payment.check_number ?? null,
        check_date: payment.check_date || null,
        check_bank: payment.check_bank ?? null,
        reference_number: payment.reference_number ?? null,
        notes: payment.notes ?? null,
        lines: toAllocationPayload(payment.lines)
      }
    })

    if (error) throw error
    if (!data?.success) throw new Error('Supplier payment creation failed')

    return {
      success: true,
      data: {
        id: data.payment_id,
        payment_number: data.payment_number,
        vendor_id: payment.vendor_id,
        payment_date: payment.payment_date,
        amount: payment.amount,
        payment_method: payment.payment_method,
        status: data.status as VoucherStatus,
        lines: payment.lines
      }
    }
  } catch (error: any) {
    console.error('Error creating supplier payment:', error)
    return { success: false, error: describeVoucherError(error) }
  }
}

/**
 * Replace the allocation set of a draft supplier payment (تعديل مسودة سند صرف)
 */
export async function updateSupplierPaymentDraft(
  paymentId: string,
  changes: Partial<Pick<SupplierPayment,
    'payment_date' | 'amount' | 'payment_method' | 'payment_account_id' |
    'check_number' | 'check_date' | 'check_bank' | 'reference_number' | 'notes'>> & {
    lines: SupplierPaymentLine[]
  }
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    if (changes.amount !== undefined) {
      assertVoucherAmounts(changes.amount, changes.lines)
    }

    const { data, error } = await supabase.rpc('rpc_update_supplier_payment_draft', {
      p_payment_id: paymentId,
      p_payload: {
        payment_date: changes.payment_date ?? null,
        amount: changes.amount ?? null,
        payment_method: changes.payment_method ?? null,
        payment_account_id: changes.payment_account_id ?? null,
        check_number: changes.check_number ?? null,
        check_date: changes.check_date || null,
        check_bank: changes.check_bank ?? null,
        reference_number: changes.reference_number ?? null,
        notes: changes.notes ?? null,
        lines: toAllocationPayload(changes.lines)
      }
    })

    if (error) throw error
    if (!data?.success) throw new Error('Supplier payment update failed')

    return { success: true, data }
  } catch (error: any) {
    console.error('Error updating supplier payment draft:', error)
    return { success: false, error: describeVoucherError(error) }
  }
}

/**
 * Cancel a supplier payment (إلغاء سند صرف)
 */
export async function cancelSupplierPayment(
  paymentId: string,
  reason: string
): Promise<{ success: boolean; data?: any; duplicate?: boolean; error?: any }> {
  try {
    const { data, error } = await supabase.rpc('rpc_cancel_supplier_payment', {
      p_payment_id: paymentId,
      p_reason: reason
    })

    if (error) throw error
    if (!data?.success) throw new Error('Supplier payment cancellation failed')

    return { success: true, data, duplicate: Boolean(data.duplicate) }
  } catch (error: any) {
    console.error('Error cancelling supplier payment:', error)
    return { success: false, error: describeVoucherError(error) }
  }
}

/**
 * Post supplier payment (إقرار سند الصرف)
 */
export async function postSupplierPayment(
  paymentId: string
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await supabase.rpc('rpc_post_supplier_payment', {
      p_payment_id: paymentId
    })
    if (error) throw error
    if (!data?.success) throw new Error('Supplier payment posting failed')
    return { success: true, data }
  } catch (error: any) {
    console.error('Error posting supplier payment:', error)
    return { success: false, error: error.message || error }
  }
}

/**
 * Return a posted supplier payment to draft for correction (إعادة إلى مسودة)
 */
export async function resetSupplierPaymentToDraft(
  paymentId: string,
  reason: string
): Promise<VoucherResetResult> {
  return resetVoucherToDraft(
    'rpc_reset_supplier_payment_to_draft',
    'p_payment_id',
    paymentId,
    reason,
    'Supplier payment reset failed'
  )
}

/**
 * Get all supplier payments
 */
export async function getAllSupplierPayments(filters?: {
  vendor_id?: string
  from_date?: string
  to_date?: string
  status?: VoucherStatus
}): Promise<{ success: boolean; data?: SupplierPayment[]; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId()

    let query = supabase
      .from('supplier_payments')
      .select(`
        *,
        vendor:vendors(*),
        lines:supplier_payment_lines(
          *,
          invoice:supplier_invoices(*)
        )
      `)
      .order('payment_date', { ascending: false })

    if (tenantId) {
      query = query.eq('org_id', tenantId)
    }

    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id)
    }

    if (filters?.from_date) {
      query = query.gte('payment_date', filters.from_date)
    }

    if (filters?.to_date) {
      query = query.lte('payment_date', filters.to_date)
    }

    if (filters?.status) {
      query = query.eq('status', filters.status)
    }

    const { data, error } = await query

    if (error) throw error

    return {
      success: true,
      data: data || []
    }
  } catch (error: any) {
    console.error('Error fetching supplier payments:', error)
    return { success: false, error: error.message || error }
  }
}

// ========================================
// Helper Functions
// ========================================

/**
 * Get payment accounts (cash/bank accounts)
 */
export async function getPaymentAccounts(): Promise<{ success: boolean; data?: any[]; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')

    // Try with full columns first
    const { data, error } = await supabase
      .from('gl_accounts')
      .select('id, code, name, name_ar, name_en, subtype, allow_posting')
      .eq('org_id', tenantId)
      .eq('is_active', true)
      .order('code')
    
    // If error with specific columns, fallback to basic
    if (error?.code === '42703') {
      console.warn('Some columns missing, using fallback query')
      const { data: data2, error: error2 } = await supabase
        .from('gl_accounts')
        .select('id, code, name')
        .eq('org_id', tenantId)
        .eq('is_active', true)
        .order('code')
      
      if (error2) throw error2
      
      // مسار احتياطي لمخطط بلا عمودَي subtype/allow_posting. يقتصر على نطاقَي
      // النقد (1101) والبنوك (1102) — الشرط السابق كان يضيف `startsWith('110')`
      // فيبتلع النطاقين الآخرين ويُلغي أثر التضييق. لا يمكنه التحقق من
      // allow_posting، فيبقى الـtrigger هو الحارس الأخير في هذا المسار.
      const filtered = (data2 || []).filter((acc: any) => {
        const code = acc.code?.toString() || ''
        return code.startsWith('1101') || code.startsWith('1102')
      })

      return {
        success: true,
        data: filtered.map((acc: any) => ({
          ...acc,
          name_ar: acc.name,
          name_en: acc.name,
          subtype: acc.code?.toString().startsWith('1101') ? 'CASH' : 'BANK'
        }))
      }
    }

    if (error) throw error

    // حسابات السداد هي CASH/BANK القابلة للترحيل وحدها. الشرط السابق كان يقبل أي
    // حساب يبدأ رمزه بـ'110'، فيسرّب الحسابات الأب غير القابلة للترحيل (110100،
    // 110200) والمدينين والمصروفات المقدمة وضريبة المدخلات إلى القائمة — ثم يرفضها
    // الـtrigger بـVOUCHER_PAYMENT_ACCOUNT_INVALID_OR_CROSS_ORG بعد أن يختارها
    // المستخدم. القائمة تعكس الآن شرط الـtrigger نفسه.
    const filtered = (data || []).filter((acc: any) =>
      (acc.subtype === 'CASH' || acc.subtype === 'BANK') && acc.allow_posting !== false
    )

    const accounts = filtered.map((acc: any) => ({
      ...acc,
      name_ar: acc.name_ar || acc.name,
      name_en: acc.name_en || acc.name
    }))

    return { success: true, data: accounts }
  } catch (error: any) {
    console.error('Error fetching payment accounts:', error)
    return { success: false, error: error.message || error }
  }
}

/**
 * Get customer outstanding invoices
 */
export async function getCustomerOutstandingInvoices(
  customerId: string
): Promise<{ success: boolean; data?: any[]; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId()

    let query = supabase
      .from('sales_invoices')
      .select('*')
      .eq('customer_id', customerId)
      .or('payment_status.eq.unpaid,payment_status.eq.partially_paid')
      .order('invoice_date', { ascending: false })

    if (tenantId) {
      query = query.eq('org_id', tenantId)
    }

    const { data, error } = await query

    if (error) throw error

    // Calculate outstanding balance
    const invoices = (data || []).map((inv: any) => ({
      ...inv,
      outstanding_balance: Number(inv.total_amount) - Number(inv.paid_amount || 0)
    }))

    return { success: true, data: invoices }
  } catch (error: any) {
    console.error('Error fetching customer invoices:', error)
    return { success: false, error: error.message || error }
  }
}

/**
 * Get supplier outstanding invoices
 */
export async function getSupplierOutstandingInvoices(
  vendorId: string
): Promise<{ success: boolean; data?: any[]; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId()

    let query = supabase
      .from('supplier_invoices')
      .select('*')
      .eq('vendor_id', vendorId)
      // مطابق لحارس القابلية للسداد في دالة ترحيل سند الصرف:
      // status NOT IN ('approved','partially_paid','overdue') → SUPPLIER_INVOICE_NOT_PAYABLE.
      // الفلتر السابق كان يخالفه في الاتجاهين: يعرض draft/submitted فتفشل عند
      // الترحيل، ويخفي partially_paid/overdue رغم أنها قابلة للسداد — فتصير أي
      // فاتورة مورد سُدّدت جزئيًا أو تجاوزت استحقاقها غير قابلة للإكمال من الواجهة.
      .in('status', ['approved', 'partially_paid', 'overdue'])
      .order('invoice_date', { ascending: false })

    if (tenantId) {
      query = query.eq('org_id', tenantId)
    }

    const { data, error } = await query

    if (error) throw error

    // Calculate outstanding balance
    const invoices = (data || []).map((inv: any) => ({
      ...inv,
      outstanding_balance: Number(inv.total_amount) - Number(inv.paid_amount || 0)
    }))

    return { success: true, data: invoices }
  } catch (error: any) {
    console.error('Error fetching supplier invoices:', error)
    return { success: false, error: error.message || error }
  }
}
