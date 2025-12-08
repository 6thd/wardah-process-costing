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

import { supabase, getEffectiveTenantId } from '@/lib/supabase'

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
// Customer Receipts Functions
// ========================================

/**
 * Generate customer receipt number
 */
async function generateReceiptNumber(): Promise<string> {
  try {
    const year = new Date().getFullYear()
    const month = String(new Date().getMonth() + 1).padStart(2, '0')
    const prefix = `CR-${year}${month}-`

    // Get last receipt number
    const { data: lastReceipt } = await supabase
      .from('customer_collections')
      .select('collection_number')
      .like('collection_number', `${prefix}%`)
      .order('collection_number', { ascending: false })
      .limit(1)
      .single()

    let sequence = 1
    if (lastReceipt?.collection_number) {
      const lastSeq = Number.parseInt(lastReceipt.collection_number.split('-')[2] || '0', 10)
      sequence = lastSeq + 1
    }

    return `${prefix}${String(sequence).padStart(5, '0')}`
  } catch (error: unknown) {
    console.error('Error generating receipt number:', error);
    // Fallback
    return `CR-${Date.now()}`
  }
}

/**
 * Create customer receipt (سند قبض)
 */
export async function createCustomerReceipt(
  receipt: Omit<CustomerReceipt, 'id' | 'receipt_number' | 'status'>
): Promise<{ success: boolean; data?: CustomerReceipt; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber()

    // Validate amount
    if (receipt.amount <= 0) {
      throw new Error('المبلغ يجب أن يكون أكبر من الصفر')
    }

    // Validate lines total matches receipt amount
    if (receipt.lines && receipt.lines.length > 0) {
      const linesTotal = receipt.lines.reduce(
        (sum, line) => sum + line.allocated_amount - (line.discount_amount || 0),
        0
      )
      if (Math.abs(linesTotal - receipt.amount) > 0.01) {
        throw new Error('مجموع البنود لا يساوي المبلغ الإجمالي')
      }
    }

    // Create receipt record
    const receiptData: any = {
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
    }

    const { data: createdReceipt, error: receiptError } = await supabase
      .from('customer_collections')
      .insert(receiptData)
      .select()
      .single()

    if (receiptError) throw receiptError

    // Create receipt lines if provided
    if (receipt.lines && receipt.lines.length > 0) {
      const linesData = receipt.lines.map(line => ({
        collection_id: createdReceipt.id,
        invoice_id: line.invoice_id,
        allocated_amount: line.allocated_amount,
        discount_amount: line.discount_amount || 0,
        notes: line.notes
      }))

      const { error: linesError } = await supabase
        .from('customer_collection_lines')
        .insert(linesData)

      if (linesError) {
        // Rollback receipt
        await supabase.from('customer_collections').delete().eq('id', createdReceipt.id)
        throw linesError
      }
    }

    return {
      success: true,
      data: {
        ...createdReceipt,
        receipt_number: createdReceipt.collection_number,
        lines: receipt.lines
      }
    }
  } catch (error: any) {
    console.error('Error creating customer receipt:', error)
    return { success: false, error: error.message || error }
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
 * Determine payment status based on amounts
 */
function determinePaymentStatus(balance: number, newPaidAmount: number): string {
  if (balance <= 0) {
    return 'paid';
  }
  if (newPaidAmount > 0) {
    return 'partially_paid';
  }
  return 'unpaid';
}

/**
 * Update invoice paid amounts
 */
async function updateInvoicePaidAmounts(lines: any[]): Promise<void> {
  if (!lines || lines.length === 0) return;

  for (const line of lines) {
    if (!line.invoice_id) continue;

    const invoice = line.invoice;
    const currentPaid = Number(invoice?.paid_amount || 0);
    const allocatedAmount = Number(line.allocated_amount || 0);
    const newPaidAmount = currentPaid + allocatedAmount;
    const totalAmount = Number(invoice?.total_amount || 0);
    const balance = totalAmount - newPaidAmount;

    const paymentStatus = determinePaymentStatus(balance, newPaidAmount);

    await supabase
      .from('sales_invoices')
      .update({
        paid_amount: newPaidAmount,
        payment_status: paymentStatus
      })
      .eq('id', line.invoice_id);
  }
}

/**
 * Update receipt status to posted
 */
async function updateReceiptStatus(receiptId: string, glEntryId: string | null, createdBy: string): Promise<any> {
  const { data: updatedReceipt, error: updateError } = await supabase
    .from('customer_collections')
    .update({
      status: 'posted',
      gl_entry_id: glEntryId,
      posted_at: new Date().toISOString(),
      posted_by: createdBy
    })
    .eq('id', receiptId)
    .select()
    .single();

  if (updateError) throw updateError;
  return updatedReceipt;
}

/**
 * Post customer receipt (إقرار سند القبض)
 */
export async function postCustomerReceipt(
  receiptId: string
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get receipt with lines
    const { data: receipt, error: receiptError } = await supabase
      .from('customer_collections')
      .select(`
        *,
        customer:customers(*),
        lines:customer_collection_lines(
          *,
          invoice:sales_invoices(*)
        )
      `)
      .eq('id', receiptId)
      .single();

    if (receiptError) throw receiptError;
    validateReceiptStatus(receipt);

    // Update invoice paid amounts
    await updateInvoicePaidAmounts(receipt.lines);

    // Create accounting entry
    const glEntryId = await createReceiptAccountingEntry(receipt);

    // Update receipt status
    const updatedReceipt = await updateReceiptStatus(receiptId, glEntryId, receipt.created_by);

    return { success: true, data: updatedReceipt };
  } catch (error: any) {
    console.error('Error posting customer receipt:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Create accounting entry for customer receipt
 */
async function createReceiptAccountingEntry(receipt: any): Promise<string | null> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) return null

    // Get payment account (cash/bank)
    let paymentAccountId = receipt.payment_account_id
    if (!paymentAccountId) {
      // Try to get default account based on payment method
      const accountSubtype = receipt.payment_method === 'cash' ? 'CASH' : 'BANK'
      const { data: accounts } = await supabase
        .from('gl_accounts')
        .select('id')
        .eq('org_id', tenantId)
        .eq('subtype', accountSubtype)
        .eq('is_active', true)
        .limit(1)

      if (accounts && accounts.length > 0) {
        paymentAccountId = accounts[0].id
      }
    }

    // Get customer AR account
    const { data: arAccounts } = await supabase
      .from('gl_accounts')
      .select('id')
      .eq('org_id', tenantId)
      .eq('subtype', 'ACCOUNTS_RECEIVABLE')
      .eq('is_active', true)
      .limit(1)

    if (!paymentAccountId || !arAccounts || arAccounts.length === 0) {
      console.warn('GL accounts not found for receipt, skipping accounting entry')
      return null
    }

    const arAccountId = arAccounts[0].id

    // Create journal entry directly
    // First create the entry header
    const { data: entry, error: entryError } = await supabase
      .from('gl_entries')
      .insert({
        org_id: tenantId,
        entry_date: receipt.collection_date,
        description: `سند قبض ${receipt.collection_number}`,
        description_ar: `سند قبض ${receipt.collection_number}`,
        reference_type: 'CUSTOMER_RECEIPT',
        reference_number: receipt.collection_number,
        total_debit: receipt.amount,
        total_credit: receipt.amount,
        status: 'posted'
      })
      .select()
      .single()

    if (entryError) {
      console.error('Error creating journal entry:', entryError)
      return null
    }

    // Create entry lines
    const { error: linesError } = await supabase
      .from('gl_entry_lines')
      .insert([
        {
          org_id: tenantId,
          entry_id: entry.id,
          line_number: 1,
          account_id: paymentAccountId,
          debit_amount: receipt.amount,
          credit_amount: 0,
          description: `سند قبض ${receipt.collection_number}`,
          description_ar: `سند قبض ${receipt.collection_number}`
        },
        {
          org_id: tenantId,
          entry_id: entry.id,
          line_number: 2,
          account_id: arAccountId,
          debit_amount: 0,
          credit_amount: receipt.amount,
          description: `سند قبض ${receipt.collection_number}`,
          description_ar: `سند قبض ${receipt.collection_number}`
        }
      ])

    if (linesError) {
      console.error('Error creating journal entry lines:', linesError)
      // Delete entry if lines failed
      await supabase.from('gl_entries').delete().eq('id', entry.id)
      return null
    }

    return entry.id
  } catch (error: any) {
    console.error('Error creating receipt accounting entry:', error)
    return null
  }
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
 * Generate supplier payment number
 */
async function generatePaymentNumber(): Promise<string> {
  try {
    const year = new Date().getFullYear()
    const month = String(new Date().getMonth() + 1).padStart(2, '0')
    const prefix = `SP-${year}${month}-`

    // Get last payment number
    const { data: lastPayment } = await supabase
      .from('supplier_payments')
      .select('payment_number')
      .like('payment_number', `${prefix}%`)
      .order('payment_number', { ascending: false })
      .limit(1)
      .single()

    let sequence = 1
    if (lastPayment?.payment_number) {
      const lastSeq = Number.parseInt(lastPayment.payment_number.split('-')[2] || '0', 10)
      sequence = lastSeq + 1
    }

    return `${prefix}${String(sequence).padStart(5, '0')}`
  } catch (error: unknown) {
    console.error('Error generating payment number:', error);
    // Fallback
    return `SP-${Date.now()}`
  }
}

/**
 * Create supplier payment (سند صرف)
 */
export async function createSupplierPayment(
  payment: Omit<SupplierPayment, 'id' | 'payment_number' | 'status'>
): Promise<{ success: boolean; data?: SupplierPayment; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) throw new Error('Tenant ID not found')

    // Generate payment number
    const paymentNumber = await generatePaymentNumber()

    // Validate amount
    if (payment.amount <= 0) {
      throw new Error('المبلغ يجب أن يكون أكبر من الصفر')
    }

    // Validate lines total matches payment amount
    if (payment.lines && payment.lines.length > 0) {
      const linesTotal = payment.lines.reduce(
        (sum, line) => sum + line.allocated_amount - (line.discount_amount || 0),
        0
      )
      if (Math.abs(linesTotal - payment.amount) > 0.01) {
        throw new Error('مجموع البنود لا يساوي المبلغ الإجمالي')
      }
    }

    // Create payment record
    const paymentData: any = {
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
    }

    const { data: createdPayment, error: paymentError } = await supabase
      .from('supplier_payments')
      .insert(paymentData)
      .select()
      .single()

    if (paymentError) throw paymentError

    // Create payment lines if provided
    if (payment.lines && payment.lines.length > 0) {
      const linesData = payment.lines.map(line => ({
        payment_id: createdPayment.id,
        invoice_id: line.invoice_id,
        allocated_amount: line.allocated_amount,
        discount_amount: line.discount_amount || 0,
        notes: line.notes
      }))

      const { error: linesError } = await supabase
        .from('supplier_payment_lines')
        .insert(linesData)

      if (linesError) {
        // Rollback payment
        await supabase.from('supplier_payments').delete().eq('id', createdPayment.id)
        throw linesError
      }
    }

    return {
      success: true,
      data: {
        ...createdPayment,
        lines: payment.lines
      }
    }
  } catch (error: any) {
    console.error('Error creating supplier payment:', error)
    return { success: false, error: error.message || error }
  }
}

/**
 * Update supplier invoice paid amounts
 */
async function updateSupplierInvoicePaidAmounts(lines: any[]): Promise<void> {
  if (!lines || lines.length === 0) return;

  for (const line of lines) {
    if (!line.invoice_id) continue;

    const invoice = line.invoice;
    const currentPaid = Number(invoice?.paid_amount || 0);
    const allocatedAmount = Number(line.allocated_amount || 0);
    const newPaidAmount = currentPaid + allocatedAmount;
    const totalAmount = Number(invoice?.total_amount || 0);
    const balance = totalAmount - newPaidAmount;

    const paymentStatus = determinePaymentStatus(balance, newPaidAmount);

    await supabase
      .from('supplier_invoices')
      .update({
        paid_amount: newPaidAmount,
        status: paymentStatus
      })
      .eq('id', line.invoice_id);
  }
}

/**
 * Update payment status to posted
 */
async function updatePaymentStatus(paymentId: string, glEntryId: string | null, createdBy: string): Promise<any> {
  const { data: updatedPayment, error: updateError } = await supabase
    .from('supplier_payments')
    .update({
      status: 'posted',
      gl_entry_id: glEntryId,
      posted_at: new Date().toISOString(),
      posted_by: createdBy
    })
    .eq('id', paymentId)
    .select()
    .single();

  if (updateError) throw updateError;
  return updatedPayment;
}

/**
 * Post supplier payment (إقرار سند الصرف)
 */
export async function postSupplierPayment(
  paymentId: string
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get payment with lines
    const { data: payment, error: paymentError } = await supabase
      .from('supplier_payments')
      .select(`
        *,
        vendor:vendors(*),
        lines:supplier_payment_lines(
          *,
          invoice:supplier_invoices(*)
        )
      `)
      .eq('id', paymentId)
      .single();

    if (paymentError) throw paymentError;
    validateReceiptStatus(payment);

    // Update invoice paid amounts
    await updateSupplierInvoicePaidAmounts(payment.lines);

    // Create accounting entry
    const glEntryId = await createPaymentAccountingEntry(payment);

    // Update payment status
    const updatedPayment = await updatePaymentStatus(paymentId, glEntryId, payment.created_by);

    return { success: true, data: updatedPayment };
  } catch (error: any) {
    console.error('Error posting supplier payment:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Create accounting entry for supplier payment
 */
async function createPaymentAccountingEntry(payment: any): Promise<string | null> {
  try {
    const tenantId = await getEffectiveTenantId()
    if (!tenantId) return null

    // Get payment account (cash/bank)
    let paymentAccountId = payment.payment_account_id
    if (!paymentAccountId) {
      // Try to get default account based on payment method
      const accountSubtype = payment.payment_method === 'cash' ? 'CASH' : 'BANK'
      const { data: accounts } = await supabase
        .from('gl_accounts')
        .select('id')
        .eq('org_id', tenantId)
        .eq('subtype', accountSubtype)
        .eq('is_active', true)
        .limit(1)

      if (accounts && accounts.length > 0) {
        paymentAccountId = accounts[0].id
      }
    }

    // Get supplier AP account
    const { data: apAccounts } = await supabase
      .from('gl_accounts')
      .select('id')
      .eq('org_id', tenantId)
      .eq('subtype', 'ACCOUNTS_PAYABLE')
      .eq('is_active', true)
      .limit(1)

    if (!paymentAccountId || !apAccounts || apAccounts.length === 0) {
      console.warn('GL accounts not found for payment, skipping accounting entry')
      return null
    }

    const apAccountId = apAccounts[0].id

    // Create journal entry directly
    // First create the entry header
    const { data: entry, error: entryError } = await supabase
      .from('gl_entries')
      .insert({
        org_id: tenantId,
        entry_date: payment.payment_date,
        description: `سند صرف ${payment.payment_number}`,
        description_ar: `سند صرف ${payment.payment_number}`,
        reference_type: 'SUPPLIER_PAYMENT',
        reference_number: payment.payment_number,
        total_debit: payment.amount,
        total_credit: payment.amount,
        status: 'posted'
      })
      .select()
      .single()

    if (entryError) {
      console.error('Error creating journal entry:', entryError)
      return null
    }

    // Create entry lines
    const { error: linesError } = await supabase
      .from('gl_entry_lines')
      .insert([
        {
          org_id: tenantId,
          entry_id: entry.id,
          line_number: 1,
          account_id: apAccountId,
          debit_amount: payment.amount,
          credit_amount: 0,
          description: `سند صرف ${payment.payment_number}`,
          description_ar: `سند صرف ${payment.payment_number}`
        },
        {
          org_id: tenantId,
          entry_id: entry.id,
          line_number: 2,
          account_id: paymentAccountId,
          debit_amount: 0,
          credit_amount: payment.amount,
          description: `سند صرف ${payment.payment_number}`,
          description_ar: `سند صرف ${payment.payment_number}`
        }
      ])

    if (linesError) {
      console.error('Error creating journal entry lines:', linesError)
      // Delete entry if lines failed
      await supabase.from('gl_entries').delete().eq('id', entry.id)
      return null
    }

    return entry.id
  } catch (error: any) {
    console.error('Error creating payment accounting entry:', error)
    return null
  }
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
    let { data, error } = await supabase
      .from('gl_accounts')
      .select('id, code, name, name_ar, name_en, subtype')
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
      
      // Filter manually by checking if code starts with cash/bank codes
      const filtered = (data2 || []).filter((acc: any) => {
        const code = acc.code?.toString() || ''
        return code.startsWith('1101') || code.startsWith('1102') || code.startsWith('110')
      })
      
      return { 
        success: true, 
        data: filtered.map((acc: any) => ({
          ...acc,
          name_ar: acc.name,
          name_en: acc.name,
          subtype: acc.code?.startsWith('1101') ? 'CASH' : 'BANK'
        }))
      }
    }

    if (error) throw error

    // Filter by subtype and ensure name_ar/name_en
    const filtered = (data || []).filter((acc: any) => 
      acc.subtype === 'CASH' || acc.subtype === 'BANK' ||
      acc.code?.toString().startsWith('110')
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
      .or('status.eq.draft,status.eq.submitted,status.eq.approved')
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

