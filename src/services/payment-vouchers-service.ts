// Payment vouchers service: customer receipts and supplier payments.
// Accounting entries are created through rpc_create_journal_entry so the GL
// header and legal debit/credit lines are written atomically.

import { supabase as _supabase, getEffectiveTenantId } from '@/lib/supabase'

const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

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
  payment_account_id?: string
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
  customer?: { id: string; name: string; name_ar?: string }
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
  payment_account_id?: string
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
  vendor?: { id: string; name: string; name_ar?: string }
}

export interface SupplierPaymentLine {
  id?: string
  payment_id?: string
  invoice_id: string
  allocated_amount: number
  discount_amount?: number
  notes?: string
}

type ServiceResult<T> = { success: boolean; data?: T; error?: string }

type VoucherJournalPayload = {
  org_id: string
  entry_date: string
  description: string
  description_ar: string
  reference_type: 'CUSTOMER_RECEIPT' | 'SUPPLIER_PAYMENT'
  reference_number: string
  idempotency_key: string
  auto_post: true
  lines: Array<{
    line_number: number
    account_id: string
    debit: number
    credit: number
    currency_code: 'SAR'
    description: string
    description_ar: string
  }>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? error)
  }
  return String(error)
}

function validatePositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('المبلغ يجب أن يكون أكبر من الصفر')
  }
}

function validateAllocationTotal(
  amount: number,
  lines?: Array<{ allocated_amount: number; discount_amount?: number }>
): void {
  if (!lines?.length) return
  const total = lines.reduce(
    (sum, line) => sum + Number(line.allocated_amount || 0) - Number(line.discount_amount || 0),
    0
  )
  if (Math.abs(total - amount) > 0.01) {
    throw new Error('مجموع البنود لا يساوي المبلغ الإجمالي')
  }
}

function validateDraftStatus(voucher: { status?: string }): void {
  if (voucher.status === 'posted') throw new Error('السند مقرر مسبقاً')
  if (voucher.status === 'cancelled') throw new Error('لا يمكن إقرار سند ملغي')
  if (voucher.status !== 'draft') throw new Error('حالة السند غير صالحة للإقرار')
}

function determinePaymentStatus(balance: number, paidAmount: number): string {
  if (balance <= 0) return 'paid'
  if (paidAmount > 0) return 'partially_paid'
  return 'unpaid'
}

async function generateSequenceNumber(table: string, column: string, prefix: string): Promise<string> {
  try {
    const { data } = await supabase
      .from(table)
      .select(column)
      .like(column, `${prefix}%`)
      .order(column, { ascending: false })
      .limit(1)
      .single()

    const previous = data?.[column] as string | undefined
    const sequence = previous ? Number.parseInt(previous.split('-')[2] || '0', 10) + 1 : 1
    return `${prefix}${String(sequence).padStart(5, '0')}`
  } catch (error) {
    console.error(`Error generating ${column}:`, error)
    return `${prefix}${Date.now()}`
  }
}

function currentPrefix(kind: 'CR' | 'SP'): string {
  const now = new Date()
  return `${kind}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`
}

async function generateReceiptNumber(): Promise<string> {
  return generateSequenceNumber('customer_collections', 'collection_number', currentPrefix('CR'))
}

async function generatePaymentNumber(): Promise<string> {
  return generateSequenceNumber('supplier_payments', 'payment_number', currentPrefix('SP'))
}

export async function createCustomerReceipt(
  receipt: Omit<CustomerReceipt, 'id' | 'receipt_number' | 'status'>
): Promise<ServiceResult<CustomerReceipt>> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')
    validatePositiveAmount(receipt.amount)
    validateAllocationTotal(receipt.amount, receipt.lines)

    const receiptNumber = await generateReceiptNumber()
    const { data: createdReceipt, error } = await supabase
      .from('customer_collections')
      .insert({
        org_id: tenantId,
        collection_number: receiptNumber,
        customer_id: receipt.customer_id,
        collection_date: receipt.receipt_date,
        amount: receipt.amount,
        payment_method: receipt.payment_method,
        payment_account_id: receipt.payment_account_id,
        check_number: receipt.check_number,
        check_date: receipt.check_date,
        reference_number: receipt.reference_number,
        notes: receipt.notes,
        status: 'draft',
        created_by: receipt.created_by
      })
      .select()
      .single()

    if (error) throw error

    if (receipt.lines?.length) {
      const { error: linesError } = await supabase.from('customer_collection_lines').insert(
        receipt.lines.map(line => ({
          collection_id: createdReceipt.id,
          invoice_id: line.invoice_id,
          allocated_amount: line.allocated_amount,
          discount_amount: line.discount_amount || 0,
          notes: line.notes
        }))
      )
      if (linesError) {
        await supabase.from('customer_collections').delete().eq('id', createdReceipt.id)
        throw linesError
      }
    }

    return {
      success: true,
      data: { ...createdReceipt, receipt_number: createdReceipt.collection_number, lines: receipt.lines }
    }
  } catch (error) {
    console.error('Error creating customer receipt:', error)
    return { success: false, error: errorMessage(error) }
  }
}

export async function createSupplierPayment(
  payment: Omit<SupplierPayment, 'id' | 'payment_number' | 'status'>
): Promise<ServiceResult<SupplierPayment>> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')
    validatePositiveAmount(payment.amount)
    validateAllocationTotal(payment.amount, payment.lines)

    const paymentNumber = await generatePaymentNumber()
    const { data: createdPayment, error } = await supabase
      .from('supplier_payments')
      .insert({
        org_id: tenantId,
        payment_number: paymentNumber,
        vendor_id: payment.vendor_id,
        payment_date: payment.payment_date,
        amount: payment.amount,
        payment_method: payment.payment_method,
        payment_account_id: payment.payment_account_id,
        check_number: payment.check_number,
        check_date: payment.check_date,
        check_bank: payment.check_bank,
        reference_number: payment.reference_number,
        notes: payment.notes,
        status: 'draft',
        created_by: payment.created_by
      })
      .select()
      .single()

    if (error) throw error

    if (payment.lines?.length) {
      const { error: linesError } = await supabase.from('supplier_payment_lines').insert(
        payment.lines.map(line => ({
          payment_id: createdPayment.id,
          invoice_id: line.invoice_id,
          allocated_amount: line.allocated_amount,
          discount_amount: line.discount_amount || 0,
          notes: line.notes
        }))
      )
      if (linesError) {
        await supabase.from('supplier_payments').delete().eq('id', createdPayment.id)
        throw linesError
      }
    }

    return { success: true, data: { ...createdPayment, lines: payment.lines } }
  } catch (error) {
    console.error('Error creating supplier payment:', error)
    return { success: false, error: errorMessage(error) }
  }
}

async function resolveAccountId(
  tenantId: string,
  explicitAccountId: string | undefined,
  subtype: string,
  label: string
): Promise<string> {
  let query = supabase
    .from('gl_accounts')
    .select('id')
    .eq('org_id', tenantId)
    .eq('is_active', true)

  query = explicitAccountId ? query.eq('id', explicitAccountId) : query.eq('subtype', subtype)
  const { data, error } = await query.limit(1)
  if (error) throw error
  const accountId = data?.[0]?.id as string | undefined
  if (!accountId) throw new Error(`GL_ACCOUNT_MISSING: ${label}`)
  return accountId
}

export function buildCustomerReceiptJournalPayload(args: {
  tenantId: string
  receipt: { id: string; collection_date: string; collection_number: string; amount: number }
  paymentAccountId: string
  arAccountId: string
}): VoucherJournalPayload {
  const description = `سند قبض ${args.receipt.collection_number}`
  return {
    org_id: args.tenantId,
    entry_date: args.receipt.collection_date,
    description,
    description_ar: description,
    reference_type: 'CUSTOMER_RECEIPT',
    reference_number: args.receipt.collection_number,
    idempotency_key: `CUSTOMER_RECEIPT:${args.tenantId}:${args.receipt.id}`,
    auto_post: true,
    lines: [
      {
        line_number: 1,
        account_id: args.paymentAccountId,
        debit: Number(args.receipt.amount),
        credit: 0,
        currency_code: 'SAR',
        description,
        description_ar: description
      },
      {
        line_number: 2,
        account_id: args.arAccountId,
        debit: 0,
        credit: Number(args.receipt.amount),
        currency_code: 'SAR',
        description,
        description_ar: description
      }
    ]
  }
}

export function buildSupplierPaymentJournalPayload(args: {
  tenantId: string
  payment: { id: string; payment_date: string; payment_number: string; amount: number }
  paymentAccountId: string
  apAccountId: string
}): VoucherJournalPayload {
  const description = `سند صرف ${args.payment.payment_number}`
  return {
    org_id: args.tenantId,
    entry_date: args.payment.payment_date,
    description,
    description_ar: description,
    reference_type: 'SUPPLIER_PAYMENT',
    reference_number: args.payment.payment_number,
    idempotency_key: `SUPPLIER_PAYMENT:${args.tenantId}:${args.payment.id}`,
    auto_post: true,
    lines: [
      {
        line_number: 1,
        account_id: args.apAccountId,
        debit: Number(args.payment.amount),
        credit: 0,
        currency_code: 'SAR',
        description,
        description_ar: description
      },
      {
        line_number: 2,
        account_id: args.paymentAccountId,
        debit: 0,
        credit: Number(args.payment.amount),
        currency_code: 'SAR',
        description,
        description_ar: description
      }
    ]
  }
}

async function createPostedJournalEntry(payload: VoucherJournalPayload): Promise<string> {
  const { data, error } = await supabase.rpc('rpc_create_journal_entry', { p_payload: payload })
  if (error) throw error
  if (!data?.success || !data?.entry_id || data?.status !== 'posted') {
    throw new Error('GL_POST_FAILED: rpc_create_journal_entry did not return a posted entry')
  }
  return String(data.entry_id)
}

async function updateCustomerInvoicePaidAmounts(lines: any[]): Promise<void> {
  for (const line of lines || []) {
    if (!line.invoice_id) continue
    const currentPaid = Number(line.invoice?.paid_amount || 0)
    const allocated = Number(line.allocated_amount || 0)
    const newPaid = currentPaid + allocated
    const balance = Number(line.invoice?.total_amount || 0) - newPaid
    const { error } = await supabase
      .from('sales_invoices')
      .update({ paid_amount: newPaid, payment_status: determinePaymentStatus(balance, newPaid) })
      .eq('id', line.invoice_id)
    if (error) throw error
  }
}

async function updateSupplierInvoicePaidAmounts(lines: any[]): Promise<void> {
  for (const line of lines || []) {
    if (!line.invoice_id) continue
    const currentPaid = Number(line.invoice?.paid_amount || 0)
    const allocated = Number(line.allocated_amount || 0)
    const newPaid = currentPaid + allocated
    const balance = Number(line.invoice?.total_amount || 0) - newPaid
    const { error } = await supabase
      .from('supplier_invoices')
      .update({ paid_amount: newPaid, status: determinePaymentStatus(balance, newPaid) })
      .eq('id', line.invoice_id)
    if (error) throw error
  }
}

export async function postCustomerReceipt(receiptId: string): Promise<ServiceResult<any>> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')

    const { data: receipt, error } = await supabase
      .from('customer_collections')
      .select(`*, customer:customers(*), lines:customer_collection_lines(*, invoice:sales_invoices(*))`)
      .eq('id', receiptId)
      .eq('org_id', tenantId)
      .single()
    if (error) throw error
    validateDraftStatus(receipt)

    const paymentSubtype = receipt.payment_method === 'cash' ? 'CASH' : 'BANK'
    const paymentAccountId = await resolveAccountId(
      tenantId,
      receipt.payment_account_id,
      paymentSubtype,
      'payment account'
    )
    const arAccountId = await resolveAccountId(tenantId, undefined, 'ACCOUNTS_RECEIVABLE', 'accounts receivable')
    const glEntryId = await createPostedJournalEntry(
      buildCustomerReceiptJournalPayload({ tenantId, receipt, paymentAccountId, arAccountId })
    )

    await updateCustomerInvoicePaidAmounts(receipt.lines)
    const { data: updatedReceipt, error: updateError } = await supabase
      .from('customer_collections')
      .update({
        status: 'posted',
        gl_entry_id: glEntryId,
        posted_at: new Date().toISOString(),
        posted_by: receipt.created_by || null
      })
      .eq('id', receiptId)
      .eq('org_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single()
    if (updateError) throw updateError
    if (!updatedReceipt?.gl_entry_id) throw new Error('VOUCHER_POST_FAILED: receipt has no GL entry')
    return { success: true, data: updatedReceipt }
  } catch (error) {
    console.error('Error posting customer receipt:', error)
    return { success: false, error: errorMessage(error) }
  }
}

export async function postSupplierPayment(paymentId: string): Promise<ServiceResult<any>> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')

    const { data: payment, error } = await supabase
      .from('supplier_payments')
      .select(`*, vendor:vendors(*), lines:supplier_payment_lines(*, invoice:supplier_invoices(*))`)
      .eq('id', paymentId)
      .eq('org_id', tenantId)
      .single()
    if (error) throw error
    validateDraftStatus(payment)

    const paymentSubtype = payment.payment_method === 'cash' ? 'CASH' : 'BANK'
    const paymentAccountId = await resolveAccountId(
      tenantId,
      payment.payment_account_id,
      paymentSubtype,
      'payment account'
    )
    const apAccountId = await resolveAccountId(tenantId, undefined, 'ACCOUNTS_PAYABLE', 'accounts payable')
    const glEntryId = await createPostedJournalEntry(
      buildSupplierPaymentJournalPayload({ tenantId, payment, paymentAccountId, apAccountId })
    )

    await updateSupplierInvoicePaidAmounts(payment.lines)
    const { data: updatedPayment, error: updateError } = await supabase
      .from('supplier_payments')
      .update({
        status: 'posted',
        gl_entry_id: glEntryId,
        posted_at: new Date().toISOString(),
        posted_by: payment.created_by || null
      })
      .eq('id', paymentId)
      .eq('org_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single()
    if (updateError) throw updateError
    if (!updatedPayment?.gl_entry_id) throw new Error('VOUCHER_POST_FAILED: payment has no GL entry')
    return { success: true, data: updatedPayment }
  } catch (error) {
    console.error('Error posting supplier payment:', error)
    return { success: false, error: errorMessage(error) }
  }
}

export async function getAllCustomerReceipts(filters?: {
  customer_id?: string
  from_date?: string
  to_date?: string
  status?: VoucherStatus
}): Promise<ServiceResult<CustomerReceipt[]>> {
  try {
    const tenantId = await getEffectiveTenantId()
    let query = supabase
      .from('customer_collections')
      .select(`*, customer:customers(*), lines:customer_collection_lines(*, invoice:sales_invoices(*))`)
      .order('collection_date', { ascending: false })
    if (tenantId) query = query.eq('org_id', tenantId)
    if (filters?.customer_id) query = query.eq('customer_id', filters.customer_id)
    if (filters?.from_date) query = query.gte('collection_date', filters.from_date)
    if (filters?.to_date) query = query.lte('collection_date', filters.to_date)
    if (filters?.status) query = query.eq('status', filters.status)
    const { data, error } = await query
    if (error) throw error
    return {
      success: true,
      data: (data || []).map((row: any) => ({ ...row, receipt_number: row.collection_number }))
    }
  } catch (error) {
    console.error('Error fetching customer receipts:', error)
    return { success: false, error: errorMessage(error) }
  }
}

export async function getAllSupplierPayments(filters?: {
  vendor_id?: string
  from_date?: string
  to_date?: string
  status?: VoucherStatus
}): Promise<ServiceResult<SupplierPayment[]>> {
  try {
    const tenantId = await getEffectiveTenantId()
    let query = supabase
      .from('supplier_payments')
      .select(`*, vendor:vendors(*), lines:supplier_payment_lines(*, invoice:supplier_invoices(*))`)
      .order('payment_date', { ascending: false })
    if (tenantId) query = query.eq('org_id', tenantId)
    if (filters?.vendor_id) query = query.eq('vendor_id', filters.vendor_id)
    if (filters?.from_date) query = query.gte('payment_date', filters.from_date)
    if (filters?.to_date) query = query.lte('payment_date', filters.to_date)
    if (filters?.status) query = query.eq('status', filters.status)
    const { data, error } = await query
    if (error) throw error
    return { success: true, data: data || [] }
  } catch (error) {
    console.error('Error fetching supplier payments:', error)
    return { success: false, error: errorMessage(error) }
  }
}

export async function getPaymentAccounts(): Promise<ServiceResult<any[]>> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')
    const { data, error } = await supabase
      .from('gl_accounts')
      .select('id, code, name, name_ar, name_en, subtype')
      .eq('org_id', tenantId)
      .eq('is_active', true)
      .order('code')
    if (error) throw error
    const accounts = (data || [])
      .filter((account: any) =>
        account.subtype === 'CASH' ||
        account.subtype === 'BANK' ||
        account.code?.toString().startsWith('110')
      )
      .map((account: any) => ({
        ...account,
        name_ar: account.name_ar || account.name,
        name_en: account.name_en || account.name
      }))
    return { success: true, data: accounts }
  } catch (error) {
    console.error('Error fetching payment accounts:', error)
    return { success: false, error: errorMessage(error) }
  }
}

export async function getCustomerOutstandingInvoices(customerId: string): Promise<ServiceResult<any[]>> {
  try {
    const tenantId = await getEffectiveTenantId()
    let query = supabase
      .from('sales_invoices')
      .select('*')
      .eq('customer_id', customerId)
      .or('payment_status.eq.unpaid,payment_status.eq.partially_paid')
      .order('invoice_date', { ascending: false })
    if (tenantId) query = query.eq('org_id', tenantId)
    const { data, error } = await query
    if (error) throw error
    return {
      success: true,
      data: (data || []).map((invoice: any) => ({
        ...invoice,
        outstanding_balance: Number(invoice.total_amount) - Number(invoice.paid_amount || 0)
      }))
    }
  } catch (error) {
    console.error('Error fetching customer invoices:', error)
    return { success: false, error: errorMessage(error) }
  }
}

export async function getSupplierOutstandingInvoices(vendorId: string): Promise<ServiceResult<any[]>> {
  try {
    const tenantId = await getEffectiveTenantId()
    let query = supabase
      .from('supplier_invoices')
      .select('*')
      .eq('vendor_id', vendorId)
      .or('status.eq.draft,status.eq.submitted,status.eq.approved')
      .order('invoice_date', { ascending: false })
    if (tenantId) query = query.eq('org_id', tenantId)
    const { data, error } = await query
    if (error) throw error
    return {
      success: true,
      data: (data || []).map((invoice: any) => ({
        ...invoice,
        outstanding_balance: Number(invoice.total_amount) - Number(invoice.paid_amount || 0)
      }))
    }
  } catch (error) {
    console.error('Error fetching supplier invoices:', error)
    return { success: false, error: errorMessage(error) }
  }
}
