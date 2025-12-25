/**
 * Enhanced Sales Service - Professional Sales Module
 * خدمة المبيعات المحسّنة - موديول مبيعات احترافي
 * 
 * Features:
 * - Complete sales cycle (Order → Invoice → Delivery → Collection)
 * - Real-time inventory integration with AVCO
 * - Automatic accounting entries
 * - Credit limit validation
 * - Auto-numbering
 * - Status management
 * - Discount and tax handling
 * - COGS calculation
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { JournalService } from './accounting/journal-service';

// ===== TYPES =====

export interface SalesOrder {
  id?: string;
  so_number: string;
  customer_id: string;
  order_date: string;
  delivery_date?: string;
  status: 'draft' | 'confirmed' | 'in_production' | 'ready' | 'delivered' | 'cancelled';
  currency?: string;
  subtotal: number;
  discount_amount?: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  created_by?: string;
  approved_by?: string;
}

export interface SalesOrderLine {
  id?: string;
  so_id: string;
  item_id: string;
  line_number: number;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_percentage?: number;
  total_price: number;
  delivered_quantity?: number;
  unit_cost?: number;
  total_cogs?: number;
  notes?: string;
}

export interface SalesInvoice {
  id?: string;
  invoice_number: string;
  so_id?: string; // Optional: can create invoice without order
  customer_id: string;
  invoice_date: string;
  due_date: string;
  payment_terms?: string;
  delivery_status: 'pending' | 'partially_delivered' | 'fully_delivered';
  payment_status: 'unpaid' | 'partially_paid' | 'paid';
  subtotal: number;
  discount_amount?: number;
  tax_amount: number;
  total_amount: number;
  paid_amount?: number;
  notes?: string;
  lines: SalesInvoiceLine[];
}

export interface SalesInvoiceLine {
  id?: string;
  invoice_id?: string;
  item_id: string;
  line_number?: number;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_percentage?: number;
  line_total: number;
  delivered_quantity?: number;
  unit_cost_at_delivery?: number;
  cogs_amount?: number;
  notes?: string;
}

export interface DeliveryNote {
  id?: string;
  delivery_number?: string;
  sales_invoice_id: string;
  customer_id: string;
  delivery_date: string;
  vehicle_number?: string;
  driver_name?: string;
  status?: 'draft' | 'confirmed' | 'delivered' | 'cancelled';
  notes?: string;
  lines: DeliveryNoteLine[];
}

export interface DeliveryNoteLine {
  id?: string;
  delivery_note_id?: string;
  sales_invoice_line_id: string;
  item_id: string;
  invoiced_quantity: number;
  delivered_quantity: number;
  unit_price: number;
  unit_cost_at_delivery: number;
  cogs_amount: number;
  notes?: string;
}

export interface CustomerCollection {
  id?: string;
  collection_number?: string;
  sales_invoice_id: string;
  customer_id: string;
  collection_date: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'check' | 'credit_card' | 'other';
  bank_account_id?: string;
  check_number?: string;
  reference_number?: string;
  notes?: string;
}

// ===== HELPER FUNCTIONS =====

/**
 * Generate next sales order number
 */
async function generateSalesOrderNumber(): Promise<string> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    const { data, error } = await supabase
      .from('sales_orders')
      .select('so_number')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows

    const lastNumber = data?.[0]?.so_number || 'SO-000000';
    const match = lastNumber.match(/SO-(\d+)/);
    const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;

    return `SO-${String(nextNum).padStart(6, '0')}`;
  } catch (error: any) {
    console.error('Error generating sales order number:', error);
    return `SO-${Date.now()}`;
  }
}

/**
 * Generate next invoice number
 */
async function generateInvoiceNumber(): Promise<string> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    const { data, error } = await supabase
      .from('sales_invoices')
      .select('invoice_number')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error && error.code !== 'PGRST116') throw error;

    const lastNumber = data?.[0]?.invoice_number || 'SI-000000';
    const match = lastNumber.match(/SI-(\d+)/);
    const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;

    return `SI-${String(nextNum).padStart(6, '0')}`;
  } catch (error: any) {
    console.error('Error generating invoice number:', error);
    return `SI-${Date.now()}`;
  }
}

/**
 * Generate next delivery note number
 */
async function generateDeliveryNumber(): Promise<string> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    const { data, error } = await supabase
      .from('delivery_notes')
      .select('delivery_number')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error && error.code !== 'PGRST116') throw error;

    const lastNumber = data?.[0]?.delivery_number || 'DN-000000';
    const match = lastNumber.match(/DN-(\d+)/);
    const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;

    return `DN-${String(nextNum).padStart(6, '0')}`;
  } catch (error: any) {
    console.error('Error generating delivery number:', error);
    return `DN-${Date.now()}`;
  }
}

// Expose selected internals for unit tests without expanding the app API surface.
// (Name is intentionally "internal-looking" to discourage app usage.)
export const __testables = {
  generateSalesOrderNumber,
  generateInvoiceNumber,
  generateDeliveryNumber
};

/**
 * Check customer credit limit
 */
async function checkCustomerCredit(customerId: string, newAmount: number): Promise<{ allowed: boolean; currentBalance: number; creditLimit: number; availableCredit: number }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get customer
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('credit_limit')
      .eq('id', customerId)
      .single();

    if (customerError) throw customerError;

    const creditLimit = Number(customer.credit_limit || 0);

    // Calculate current balance (unpaid invoices)
    const { data: unpaidInvoices } = await supabase
      .from('sales_invoices')
      .select('total_amount, paid_amount')
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .in('payment_status', ['unpaid', 'partially_paid']);

    const currentBalance = (unpaidInvoices || []).reduce((sum, inv) => {
      return sum + (Number(inv.total_amount || 0) - Number(inv.paid_amount || 0));
    }, 0);

    const availableCredit = creditLimit - currentBalance;
    const allowed = creditLimit === 0 || (currentBalance + newAmount) <= creditLimit;

    return {
      allowed,
      currentBalance,
      creditLimit,
      availableCredit
    };
  } catch (error: any) {
    console.error('Error checking customer credit:', error);
    // Allow if check fails (graceful degradation)
    return { allowed: true, currentBalance: 0, creditLimit: 0, availableCredit: 0 };
  }
}

/**
 * Check item stock availability
 */
async function checkStockAvailability(itemId: string, requiredQuantity: number): Promise<{ available: boolean; availableQty: number; itemName: string }> {
  try {
    const { data: item, error } = await supabase
      .from('items')
      .select('stock_quantity, name, name_ar')
      .eq('id', itemId)
      .single();

    if (error) throw error;

    const availableQty = Number(item.stock_quantity || 0);
    const available = availableQty >= requiredQuantity;

    return {
      available,
      availableQty,
      itemName: item.name_ar || item.name || 'Unknown'
    };
  } catch (error: any) {
    console.error('Error checking stock:', error);
    throw error;
  }
}

/**
 * Record inventory movement for sales
 */
async function recordSalesInventoryMovement(
  itemId: string,
  quantity: number,
  unitCost: number,
  referenceType: string,
  referenceId: string,
  referenceNumber?: string
): Promise<{ success: boolean; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get current item data
    const { data: item, error: itemError } = await supabase
      .from('items')
      .select('stock_quantity, cost_price, name')
      .eq('id', itemId)
      .single();

    if (itemError) throw itemError;

    const currentStock = Number(item.stock_quantity || 0);
    const currentCost = Number(item.cost_price || 0);

    // Validate stock
    if (currentStock < quantity) {
      throw new Error(`Insufficient stock for ${item.name}. Available: ${currentStock}, Required: ${quantity}`);
    }

    // Calculate new stock (outgoing - no AVCO change)
    const newStock = currentStock - quantity;
    // cogsAmount calculated but not used in this function - removed to fix SonarQube warning

    // Update item stock
    const { error: updateError } = await supabase
      .from('items')
      .update({
        stock_quantity: newStock,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId);

    if (updateError) throw updateError;

    // Record in stock_moves if table exists
    try {
      const { error: moveError } = await supabase
        .from('stock_moves')
        .insert({
          tenant_id: tenantId,
          product_id: itemId,
          quantity: -quantity, // Negative for outgoing
          move_type: 'sales_delivery',
          unit_cost_out: currentCost,
          reference_type: referenceType,
          reference_id: referenceId,
          reference_number: referenceNumber,
          status: 'done',
          date_done: new Date().toISOString()
        });

      if (moveError && moveError.code !== '42P01') { // 42P01 = table doesn't exist
        console.warn('Could not record stock move:', moveError);
      }
    } catch (error_) {
      // Ignore if stock_moves table doesn't exist
      console.warn('Stock moves table not available:', error_);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error recording inventory movement:', error);
    return { success: false, error };
  }
}

// ===== SALES ORDER FUNCTIONS =====

/**
 * Create Sales Order
 */
export async function createSalesOrder(order: Omit<SalesOrder, 'id' | 'so_number'>, lines: Omit<SalesOrderLine, 'id' | 'so_id'>[]): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // 1. Validate lines
    if (!lines || lines.length === 0) {
      throw new Error('Sales order must have at least one line');
    }

    // 2. Check stock availability for all items
    for (const line of lines) {
      const stockCheck = await checkStockAvailability(line.item_id, line.quantity);
      if (!stockCheck.available) {
        throw new Error(`Insufficient stock for ${stockCheck.itemName}. Available: ${stockCheck.availableQty}, Required: ${line.quantity}`);
      }
    }

    // 3. Check customer credit limit
    const creditCheck = await checkCustomerCredit(order.customer_id, order.total_amount);
    if (!creditCheck.allowed) {
      throw new Error(`Credit limit exceeded. Available: ${creditCheck.availableCredit.toFixed(2)}, Required: ${order.total_amount.toFixed(2)}`);
    }

    // 4. Generate order number
    const soNumber = await generateSalesOrderNumber();

    // 5. Create sales order
    const { data: soData, error: soError } = await supabase
      .from('sales_orders')
      .insert({
        tenant_id: tenantId,
        so_number: soNumber,
        customer_id: order.customer_id,
        so_date: order.order_date,
        delivery_date: order.delivery_date,
        status: order.status || 'draft',
        currency: order.currency || 'SAR',
        total_amount: order.total_amount,
        tax_amount: order.tax_amount || 0,
        discount_amount: order.discount_amount || 0,
        final_amount: order.total_amount,
        notes: order.notes,
        created_by: order.created_by
      })
      .select()
      .single();

    if (soError) throw soError;

    // 6. Create order lines
    const orderLines = lines.map((line, index) => ({
      so_id: soData.id,
      item_id: line.item_id,
      line_number: line.line_number || index + 1,
      quantity: line.quantity,
      unit_price: line.unit_price,
      total_price: line.total_price,
      delivered_quantity: 0,
      notes: line.notes
    }));

    const { error: linesError } = await supabase
      .from('sales_order_lines')
      .insert(orderLines);

    if (linesError) throw linesError;

    // 7. Get full order with relations
    const { data: fullOrder, error: fetchError } = await supabase
      .from('sales_orders')
      .select(`
        *,
        customer:customers(*),
        lines:sales_order_lines(
          *,
          item:items(*)
        )
      `)
      .eq('id', soData.id)
      .single();

    if (fetchError) throw fetchError;

    return { success: true, data: fullOrder };
  } catch (error: any) {
    console.error('Error creating sales order:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Confirm Sales Order
 */
export async function confirmSalesOrder(orderId: string): Promise<{ success: boolean; error?: any }> {
  try {
    const { error } = await supabase
      .from('sales_orders')
      .update({
        status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error confirming sales order:', error);
    return { success: false, error: error.message || error };
  }
}

// ===== SALES INVOICE FUNCTIONS =====

/**
 * Create Sales Invoice (with automatic accounting entry)
 */
export async function createSalesInvoice(invoice: Omit<SalesInvoice, 'id' | 'invoice_number'>): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // 1. Validate lines
    if (!invoice.lines || invoice.lines.length === 0) {
      throw new Error('Invoice must have at least one line');
    }

    // 2. Check stock availability
    for (const line of invoice.lines) {
      const stockCheck = await checkStockAvailability(line.item_id, line.quantity);
      if (!stockCheck.available) {
        throw new Error(`Insufficient stock for ${stockCheck.itemName}. Available: ${stockCheck.availableQty}, Required: ${line.quantity}`);
      }
    }

    // 3. Check customer credit
    const creditCheck = await checkCustomerCredit(invoice.customer_id, invoice.total_amount);
    if (!creditCheck.allowed) {
      throw new Error(`Credit limit exceeded. Available: ${creditCheck.availableCredit.toFixed(2)}, Required: ${invoice.total_amount.toFixed(2)}`);
    }

    // 4. Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // 5. Create invoice
    const { data: invData, error: invError } = await supabase
      .from('sales_invoices')
      .insert({
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        so_id: invoice.so_id,
        customer_id: invoice.customer_id,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        payment_terms: invoice.payment_terms,
        delivery_status: invoice.delivery_status || 'pending',
        payment_status: invoice.payment_status || 'unpaid',
        subtotal: invoice.subtotal,
        discount_amount: invoice.discount_amount || 0,
        tax_amount: invoice.tax_amount,
        total_amount: invoice.total_amount,
        paid_amount: invoice.paid_amount || 0,
        notes: invoice.notes
      })
      .select()
      .single();

    if (invError) throw invError;

    // 6. Create invoice lines
    const invoiceLines = invoice.lines.map((line, index) => ({
      tenant_id: tenantId,
      sales_invoice_id: invData.id,
      line_number: line.line_number || index + 1,
      product_id: line.item_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount_percentage: line.discount_percentage || 0,
      tax_percentage: line.tax_percentage || 0,
      delivered_quantity: 0,
      notes: line.notes
    }));

    const { error: linesError } = await supabase
      .from('sales_invoice_lines')
      .insert(invoiceLines);

    if (linesError) throw linesError;

    // 7. Create accounting entry for sales
    // Create invoice object with invoice_number for accounting entry
    const invoiceForAccounting: SalesInvoice = {
      ...invoice,
      id: invData.id,
      invoice_number: invoiceNumber
    };
    await createSalesAccountingEntry(invData, invoiceForAccounting);

    // 8. Get full invoice with relations
    const { data: fullInvoice, error: fetchError } = await supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(*),
        lines:sales_invoice_lines(
          *,
          product:items(*)
        )
      `)
      .eq('id', invData.id)
      .single();

    if (fetchError) throw fetchError;

    return { success: true, data: fullInvoice };
  } catch (error: any) {
    console.error('Error creating sales invoice:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Create accounting entry for sales invoice
 */
async function createSalesAccountingEntry(invoice: any, invoiceData: SalesInvoice): Promise<void> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get account codes from GL accounts
    const { data: accounts } = await supabase
      .from('gl_accounts')
      .select('id, code, category')
      .eq('tenant_id', tenantId)
      .in('code', ['1120', '4001', '2162']); // Accounts Receivable, Sales Revenue, Output VAT

    const arAccount = accounts?.find(a => a.code === '1120' || a.category === 'ASSET');
    const revenueAccount = accounts?.find(a => a.code === '4001' || a.category === 'REVENUE');
    const vatAccount = accounts?.find(a => a.code === '2162');

    if (!arAccount || !revenueAccount) {
      console.warn('GL accounts not found, skipping accounting entry');
      return;
    }

    // Calculate amounts - use invoiceData if invoice doesn't have the property
    const revenueAmount = (invoiceData.subtotal || invoice.subtotal) - ((invoiceData.discount_amount || invoice.discount_amount) || 0);
    const vatAmount = (invoiceData.tax_amount || invoice.tax_amount) || 0;
    const totalAmount = invoiceData.total_amount || invoice.total_amount;
    const invoiceNumber = invoiceData.invoice_number || invoice.invoice_number || '';
    const invoiceDate = invoiceData.invoice_date || invoice.invoice_date;

    // Create journal entry using JournalService
    const journalEntry = {
      journal_id: null, // Will use default
      entry_date: invoiceDate,
      description: `فاتورة مبيعات ${invoiceNumber}`,
      description_ar: `فاتورة مبيعات ${invoiceNumber}`,
      reference_type: 'SALES_INVOICE',
      reference_number: invoiceNumber,
      lines: [
        // Debit: Accounts Receivable
        {
          account_id: arAccount.id,
          line_number: 1,
          debit: totalAmount,
          credit: 0,
          description: `فاتورة مبيعات ${invoiceNumber}`,
          description_ar: `فاتورة مبيعات ${invoiceNumber}`
        },
        // Credit: Sales Revenue
        {
          account_id: revenueAccount.id,
          line_number: 2,
          debit: 0,
          credit: revenueAmount,
          description: `إيرادات مبيعات - ${invoiceNumber}`,
          description_ar: `إيرادات مبيعات - ${invoiceNumber}`
        }
      ]
    };

    // Add VAT line if applicable
    if (vatAmount > 0 && vatAccount) {
      journalEntry.lines.push({
        account_id: vatAccount.id,
        line_number: 3,
        debit: 0,
        credit: vatAmount,
        description: `ضريبة مخرجات - ${invoiceNumber}`,
        description_ar: `ضريبة مخرجات - ${invoiceNumber}`
      });
    }

    // Create journal entry
    const result = await JournalService.createEntry(journalEntry);
    
    if (!result.success) {
      console.error('Failed to create accounting entry:', result.error);
      // Don't throw - invoice is created, accounting entry can be created manually
    }
  } catch (error: any) {
    console.error('Error creating sales accounting entry:', error);
    // Don't throw - invoice is created
  }
}

// ===== DELIVERY NOTE FUNCTIONS =====

/**
 * Validate delivery note lines
 */
function validateDeliveryLines(lines: any[]): void {
  if (!lines || lines.length === 0) {
    throw new Error('Delivery note must have at least one line');
  }
}

/**
 * Validate invoice exists
 */
async function validateInvoiceExists(invoiceId: string): Promise<void> {
  const { error: invoiceError } = await supabase
    .from('sales_invoices')
    .select('id')
    .eq('id', invoiceId)
    .single();

  if (invoiceError) throw invoiceError;
}

/**
 * Process a single delivery line
 */
async function processDeliveryLine(
  line: any,
  dnData: any,
  tenantId: string,
  deliveryNumber: string
): Promise<number> {
  // Get item with current AVCO
  const { data: item, error: itemError } = await supabase
    .from('items')
    .select('stock_quantity, cost_price, name, name_ar')
    .eq('id', line.item_id)
    .single();

  if (itemError) throw itemError;

  // Validate stock
  const availableStock = Number(item.stock_quantity || 0);
  if (availableStock < line.delivered_quantity) {
    throw new Error(`Insufficient stock for ${item.name_ar || item.name}. Available: ${availableStock}, Required: ${line.delivered_quantity}`);
  }

  // Calculate COGS using AVCO
  const unitCostAtDelivery = Number(item.cost_price || 0);
  const lineCOGS = line.delivered_quantity * unitCostAtDelivery;

  // Create delivery line
  const { error: lineError } = await supabase
    .from('delivery_note_lines')
    .insert({
      tenant_id: tenantId,
      delivery_id: dnData.id,
      invoice_line_id: line.sales_invoice_line_id,
      product_id: line.item_id,
      quantity_delivered: line.delivered_quantity,
      unit_cost_at_delivery: unitCostAtDelivery,
      notes: line.notes
    });

  if (lineError) throw lineError;

  // Deduct inventory
  const inventoryResult = await recordSalesInventoryMovement(
    line.item_id,
    line.delivered_quantity,
    unitCostAtDelivery,
    'DELIVERY_NOTE',
    dnData.id,
    deliveryNumber
  );

  if (!inventoryResult.success) {
    throw new Error(`Failed to deduct inventory for ${item.name_ar || item.name}: ${inventoryResult.error}`);
  }

  // Update invoice line delivered quantity
  const { data: invoiceLine } = await supabase
    .from('sales_invoice_lines')
    .select('delivered_quantity')
    .eq('id', line.sales_invoice_line_id)
    .single();

  const newDeliveredQty = (Number(invoiceLine?.delivered_quantity || 0)) + line.delivered_quantity;

  await supabase
    .from('sales_invoice_lines')
    .update({ 
      delivered_quantity: newDeliveredQty,
      unit_cost_at_sale: unitCostAtDelivery
    })
    .eq('id', line.sales_invoice_line_id);

  return lineCOGS;
}

/**
 * Calculate and update invoice delivery status
 */
async function updateInvoiceDeliveryStatus(invoiceId: string): Promise<void> {
  const { data: invoiceLines } = await supabase
    .from('sales_invoice_lines')
    .select('quantity, delivered_quantity')
    .eq('sales_invoice_id', invoiceId);

  let allDelivered = true;
  let anyDelivered = false;

  if (invoiceLines) {
    for (const line of invoiceLines) {
      const qty = Number(line.quantity || 0);
      const delivered = Number(line.delivered_quantity || 0);
      if (delivered < qty) allDelivered = false;
      if (delivered > 0) anyDelivered = true;
    }
  }

  let newDeliveryStatus: string;
  if (allDelivered) {
    newDeliveryStatus = 'fully_delivered';
  } else if (anyDelivered) {
    newDeliveryStatus = 'partially_delivered';
  } else {
    newDeliveryStatus = 'pending';
  }

  await supabase
    .from('sales_invoices')
    .update({ delivery_status: newDeliveryStatus })
    .eq('id', invoiceId);
}

/**
 * Create Delivery Note (with inventory deduction and COGS entry)
 */
export async function createDeliveryNote(delivery: Omit<DeliveryNote, 'id' | 'delivery_number'>): Promise<{ success: boolean; data?: any; totalCOGS?: number; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    validateDeliveryLines(delivery.lines);
    await validateInvoiceExists(delivery.sales_invoice_id);

    const deliveryNumber = await generateDeliveryNumber();

    // Create delivery note
    const { data: dnData, error: dnError } = await supabase
      .from('delivery_notes')
      .insert({
        tenant_id: tenantId,
        delivery_number: deliveryNumber,
        sales_invoice_id: delivery.sales_invoice_id,
        customer_id: delivery.customer_id,
        delivery_date: delivery.delivery_date,
        vehicle_number: delivery.vehicle_number,
        driver_name: delivery.driver_name,
        status: delivery.status || 'confirmed',
        notes: delivery.notes
      })
      .select()
      .single();

    if (dnError) throw dnError;

    // Process each delivery line
    let totalCOGS = 0;
    for (const line of delivery.lines) {
      const lineCOGS = await processDeliveryLine(line, dnData, tenantId, deliveryNumber);
      totalCOGS += lineCOGS;
    }

    // Create COGS accounting entry
    await createCOGSAccountingEntry(dnData, totalCOGS, deliveryNumber);

    // Update invoice delivery status
    await updateInvoiceDeliveryStatus(delivery.sales_invoice_id);

    // Get full delivery note
    const { data: fullDelivery, error: fetchError } = await supabase
      .from('delivery_notes')
      .select(`
        *,
        customer:customers(*),
        sales_invoice:sales_invoices(*),
        lines:delivery_note_lines(
          *,
          product:items(*)
        )
      `)
      .eq('id', dnData.id)
      .single();

    if (fetchError) throw fetchError;

    return { success: true, data: fullDelivery, totalCOGS };
  } catch (error: any) {
    console.error('Error creating delivery note:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Create COGS accounting entry
 */
async function createCOGSAccountingEntry(deliveryNote: any, totalCOGS: number, deliveryNumber: string): Promise<void> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get account codes
    const { data: accounts } = await supabase
      .from('gl_accounts')
      .select('id, code, category')
      .eq('tenant_id', tenantId)
      .in('code', ['5001', '1130']); // COGS, Inventory

    const cogsAccount = accounts?.find(a => a.code === '5001' || a.category === 'EXPENSE');
    const inventoryAccount = accounts?.find(a => a.code === '1130' || a.category === 'ASSET');

    if (!cogsAccount || !inventoryAccount) {
      console.warn('GL accounts not found for COGS, skipping accounting entry');
      return;
    }

    // Create journal entry
    const journalEntry = {
      journal_id: null,
      entry_date: deliveryNote.delivery_date,
      description: `تكلفة بضاعة مباعة - ${deliveryNumber}`,
      description_ar: `تكلفة بضاعة مباعة - ${deliveryNumber}`,
      reference_type: 'DELIVERY_NOTE',
      reference_number: deliveryNumber,
      lines: [
        // Debit: COGS
        {
          account_id: cogsAccount.id,
          line_number: 1,
          debit: totalCOGS,
          credit: 0,
          description: `تكلفة بضاعة مباعة - ${deliveryNumber}`,
          description_ar: `تكلفة بضاعة مباعة - ${deliveryNumber}`
        },
        // Credit: Inventory
        {
          account_id: inventoryAccount.id,
          line_number: 2,
          debit: 0,
          credit: totalCOGS,
          description: `تكلفة بضاعة مباعة - ${deliveryNumber}`,
          description_ar: `تكلفة بضاعة مباعة - ${deliveryNumber}`
        }
      ]
    };

    const result = await JournalService.createEntry(journalEntry);
    
    if (!result.success) {
      console.error('Failed to create COGS accounting entry:', result.error);
    }
  } catch (error: any) {
    console.error('Error creating COGS accounting entry:', error);
  }
}

// ===== COLLECTION FUNCTIONS =====

/**
 * Record Customer Collection (with accounting entry)
 */
export async function recordCustomerCollection(collection: Omit<CustomerCollection, 'id' | 'collection_number'>): Promise<{ success: boolean; data?: any; balance?: number; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // 1. Get invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('sales_invoices')
      .select('*')
      .eq('id', collection.sales_invoice_id)
      .single();

    if (invoiceError) throw invoiceError;

    // 2. Calculate new paid amount
    const currentPaid = Number(invoice.paid_amount || 0);
    const newPaidAmount = currentPaid + collection.amount;
    const balance = Number(invoice.total_amount) - newPaidAmount;

    // 3. Determine payment status
    let paymentStatus: 'paid' | 'partially_paid' | 'unpaid' = 'unpaid';
    if (balance <= 0) {
      paymentStatus = 'paid';
    } else if (newPaidAmount > 0) {
      paymentStatus = 'partially_paid';
    }

    // 4. Generate collection number
    const collectionNumber = `COL-${Date.now()}`;

    // 5. Create collection record (if table exists)
    try {
      await supabase
        .from('customer_collections')
        .insert({
          tenant_id: tenantId,
          collection_number: collectionNumber,
          sales_invoice_id: collection.sales_invoice_id,
          customer_id: collection.customer_id,
          collection_date: collection.collection_date,
          amount: collection.amount,
          payment_method: collection.payment_method,
          bank_account_id: collection.bank_account_id,
          check_number: collection.check_number,
          reference_number: collection.reference_number,
          notes: collection.notes
        });
    // NOSONAR - Intentional graceful degradation if table doesn't exist
    } catch (error_) { // NOSONAR
      // Table might not exist, continue gracefully
      console.warn('Customer collections table not available:', error_);
    }

    // 6. Update invoice
    const { error: updateError } = await supabase
      .from('sales_invoices')
      .update({
        paid_amount: newPaidAmount,
        payment_status: paymentStatus
      })
      .eq('id', collection.sales_invoice_id);

    if (updateError) throw updateError;

    // 7. Create accounting entry
    await createCollectionAccountingEntry(collection, invoice, collectionNumber);

    return { success: true, balance: Math.max(0, balance) };
  } catch (error: any) {
    console.error('Error recording collection:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Create collection accounting entry
 */
async function createCollectionAccountingEntry(collection: CustomerCollection, invoice: any, collectionNumber: string): Promise<void> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');

    // Get account codes based on payment method
    const cashAccountCode = '1110'; // Cash
    const bankAccountCode = '1111'; // Bank
    const arAccountCode = '1120'; // Accounts Receivable

    const { data: accounts } = await supabase
      .from('gl_accounts')
      .select('id, code')
      .eq('tenant_id', tenantId)
      .in('code', [cashAccountCode, bankAccountCode, arAccountCode]);

    const paymentAccount = accounts?.find(a => 
      a.code === (collection.payment_method === 'cash' ? cashAccountCode : bankAccountCode)
    );
    const arAccount = accounts?.find(a => a.code === arAccountCode);

    if (!paymentAccount || !arAccount) {
      console.warn('GL accounts not found for collection, skipping accounting entry');
      return;
    }

    // Get invoice number safely
    const invoiceNumber = invoice?.invoice_number || collection.reference_number || collectionNumber;

    // Create journal entry
    const journalEntry = {
      journal_id: null,
      entry_date: collection.collection_date,
      description: `تحصيل من فاتورة ${invoiceNumber}`,
      description_ar: `تحصيل من فاتورة ${invoiceNumber}`,
      reference_type: 'CUSTOMER_COLLECTION',
      reference_number: collectionNumber,
      lines: [
        // Debit: Cash/Bank
        {
          account_id: paymentAccount.id,
          line_number: 1,
          debit: collection.amount,
          credit: 0,
          description: `تحصيل من فاتورة ${invoiceNumber}`,
          description_ar: `تحصيل من فاتورة ${invoiceNumber}`
        },
        // Credit: Accounts Receivable
        {
          account_id: arAccount.id,
          line_number: 2,
          debit: 0,
          credit: collection.amount,
          description: `تحصيل من فاتورة ${invoiceNumber}`,
          description_ar: `تحصيل من فاتورة ${invoiceNumber}`
        }
      ]
    };

    const result = await JournalService.createEntry(journalEntry);
    
    if (!result.success) {
      console.error('Failed to create collection accounting entry:', result.error);
    }
  } catch (error: any) {
    console.error('Error creating collection accounting entry:', error);
  }
}

// ===== QUERY FUNCTIONS =====

/**
 * Get Sales Order with details
 */
export async function getSalesOrderWithDetails(orderId: string): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('sales_orders')
      .select(`
        *,
        customer:customers(*),
        lines:sales_order_lines(
          *,
          item:items(*)
        )
      `)
      .eq('id', orderId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error: any) {
    console.error('Error fetching sales order:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Get Sales Invoice with details
 */
export async function getSalesInvoiceWithDetails(invoiceId: string): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(*),
        so:sales_orders(*),
        lines:sales_invoice_lines(
          *,
          product:items(*)
        ),
        deliveries:delivery_notes(
          *,
          lines:delivery_note_lines(*)
        )
      `)
      .eq('id', invoiceId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error: any) {
    console.error('Error fetching sales invoice:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Get Delivery Note with details
 */
export async function getDeliveryNoteWithDetails(deliveryId: string): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await supabase
      .from('delivery_notes')
      .select(`
        *,
        customer:customers(*),
        sales_invoice:sales_invoices(*),
        lines:delivery_note_lines(
          *,
          product:items(*)
        )
      `)
      .eq('id', deliveryId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error: any) {
    console.error('Error fetching delivery note:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Get all sales orders with filters
 */
export async function getAllSalesOrders(filters?: {
  status?: string;
  customer_id?: string;
  from_date?: string;
  to_date?: string;
}): Promise<{ success: boolean; data?: any[]; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();
    
    // Try with relationship first
    let query = supabase
      .from('sales_orders')
      .select(`
        *,
        customer:customers(*)
      `);

    // Use org_id (most common in schema), not tenant_id
    if (tenantId) {
      query = query.eq('org_id', tenantId);
    }

    // Use so_date (actual column name in database)
    query = query.order('so_date', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.customer_id) {
      query = query.eq('customer_id', filters.customer_id);
    }
    if (filters?.from_date) {
      query = query.gte('so_date', filters.from_date);
    }
    if (filters?.to_date) {
      query = query.lte('so_date', filters.to_date);
    }

    let { data, error } = await query;

    // If relationship fails, try without it
    if (error && (error.message?.includes('Could not find a relationship') || error.message?.includes('relationship'))) {
      console.warn('Relationship not found, fetching without customer join:', error.message);
      
      // Retry without customer relationship
      query = supabase
        .from('sales_orders')
        .select('*');

      // Use org_id, not tenant_id
      if (tenantId) {
        query = query.eq('org_id', tenantId);
      }

      // Use so_date (actual column name in database)
      query = query.order('so_date', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.customer_id) {
        query = query.eq('customer_id', filters.customer_id);
      }
      if (filters?.from_date) {
        query = query.gte('so_date', filters.from_date);
      }
      if (filters?.to_date) {
        query = query.lte('so_date', filters.to_date);
      }

      const result = await query;
      data = result.data;
      error = result.error;
    }

    if (error) throw error;

    // If we have data but no customer info, try to fetch customers separately
    if (data && data.length > 0 && !data[0].customer) {
      const customerIds = [...new Set(data.map((order: any) => order.customer_id).filter(Boolean))];
      if (customerIds.length > 0) {
        try {
          const { data: customers } = await supabase
            .from('customers')
            .select('*')
            .in('id', customerIds);
          
          if (customers) {
            const customerMap = new Map(customers.map((c: any) => [c.id, c]));
            data = data.map((order: any) => ({
              ...order,
              customer: customerMap.get(order.customer_id) || null
            }));
          }
        } catch (customerError) {
          console.warn('Could not fetch customers separately:', customerError);
        }
      }
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Error fetching sales orders:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Get all sales invoices with filters
 */
export async function getAllSalesInvoices(filters?: {
  payment_status?: string;
  delivery_status?: string;
  customer_id?: string;
  from_date?: string;
  to_date?: string;
}): Promise<{ success: boolean; data?: any[]; error?: any }> {
  try {
    const tenantId = await getEffectiveTenantId();

    // Build base query without tenant filter first
    let query = supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(*)
      `)
      .order('invoice_date', { ascending: false });

    // Apply filters
    if (filters?.payment_status) {
      query = query.eq('payment_status', filters.payment_status);
    }
    if (filters?.delivery_status) {
      query = query.eq('delivery_status', filters.delivery_status);
    }
    if (filters?.customer_id) {
      query = query.eq('customer_id', filters.customer_id);
    }
    if (filters?.from_date) {
      query = query.gte('invoice_date', filters.from_date);
    }
    if (filters?.to_date) {
      query = query.lte('invoice_date', filters.to_date);
    }

    // Try to add tenant filter if tenantId exists
    // We'll try tenant_id first, then org_id, then skip if both fail
    let data: any = null;
    let error: any = null;

    if (tenantId) {
      // sales_invoices table uses org_id, not tenant_id
      // Try with org_id first (this is the correct column name)
      try {
        let orgQuery = supabase
          .from('sales_invoices')
          .select(`
            *,
            customer:customers(*)
          `)
          .eq('org_id', tenantId)
          .order('invoice_date', { ascending: false });

        if (filters?.payment_status) {
          orgQuery = orgQuery.eq('payment_status', filters.payment_status);
        }
        if (filters?.delivery_status) {
          orgQuery = orgQuery.eq('delivery_status', filters.delivery_status);
        }
        if (filters?.customer_id) {
          orgQuery = orgQuery.eq('customer_id', filters.customer_id);
        }
        if (filters?.from_date) {
          orgQuery = orgQuery.gte('invoice_date', filters.from_date);
        }
        if (filters?.to_date) {
          orgQuery = orgQuery.lte('invoice_date', filters.to_date);
        }

        const result = await orgQuery;
        data = result.data;
        error = result.error;
        
        // If successful, return
        if (!error && data !== null) {
          return { success: true, data: data || [] };
        }
        
        // If org_id doesn't exist, try tenant_id (fallback for other schemas)
        if (error && (error.code === '42703' || error.message?.includes('org_id'))) {
          console.warn('org_id column not found in sales_invoices, trying tenant_id');
          
          // Build new query with tenant_id
          let tenantQuery = supabase
            .from('sales_invoices')
            .select(`
              *,
              customer:customers(*)
            `)
            .eq('tenant_id', tenantId)
            .order('invoice_date', { ascending: false });

          if (filters?.payment_status) {
            tenantQuery = tenantQuery.eq('payment_status', filters.payment_status);
          }
          if (filters?.delivery_status) {
            tenantQuery = tenantQuery.eq('delivery_status', filters.delivery_status);
          }
          if (filters?.customer_id) {
            tenantQuery = tenantQuery.eq('customer_id', filters.customer_id);
          }
          if (filters?.from_date) {
            tenantQuery = tenantQuery.gte('invoice_date', filters.from_date);
          }
          if (filters?.to_date) {
            tenantQuery = tenantQuery.lte('invoice_date', filters.to_date);
          }

          const tenantResult = await tenantQuery;
          data = tenantResult.data;
          error = tenantResult.error;
          
          // If successful, return
          if (!error && data !== null) {
            return { success: true, data: data || [] };
          }
          
          // If tenant_id also fails, skip tenant filter
          if (error && (error.code === '42703' || error.message?.includes('tenant_id'))) {
            console.warn('Neither org_id nor tenant_id found in sales_invoices, skipping tenant filter');
            // Query without tenant filter (use the base query we built earlier)
            const noTenantResult = await query;
            data = noTenantResult.data;
            error = noTenantResult.error;
          }
        }
      } catch (e: any) {
        // If exception thrown, try without tenant filter
        console.warn('Error with tenant filter, trying without:', e.message);
        const noTenantResult = await query;
        data = noTenantResult.data;
        error = noTenantResult.error;
      }
    } else {
      // No tenant ID, just execute query
      const result = await query;
      data = result.data;
      error = result.error;
    }

    // Only throw error if it's not about missing column
    if (error && error.code !== '42703' && !(error.message && (error.message.includes('tenant_id') || error.message.includes('org_id')))) {
      throw error;
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Error fetching sales invoices:', error);
    return { success: false, error: error.message || error };
  }
}

/**
 * Calculate invoice profit
 */
export async function calculateInvoiceProfit(invoiceId: string): Promise<{ success: boolean; revenue?: number; cogs?: number; profit?: number; profitMargin?: number; error?: any }> {
  try {
    // Get invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('sales_invoices')
      .select('total_amount, tax_amount')
      .eq('id', invoiceId)
      .single();

    if (invoiceError) throw invoiceError;

    // Get delivery notes with COGS
    const { data: deliveries, error: deliveriesError } = await supabase
      .from('delivery_notes')
      .select(`
        lines:delivery_note_lines(
          quantity_delivered,
          unit_cost_at_delivery
        )
      `)
      .eq('sales_invoice_id', invoiceId);

    if (deliveriesError) throw deliveriesError;

    // Calculate total COGS
    let totalCOGS = 0;
    (deliveries || []).forEach((delivery: any) => {
      (delivery.lines || []).forEach((line: any) => {
        const qty = Number(line.quantity_delivered || 0);
        const cost = Number(line.unit_cost_at_delivery || 0);
        totalCOGS += qty * cost;
      });
    });

    const revenue = Number(invoice.total_amount || 0) - Number(invoice.tax_amount || 0);
    const profit = revenue - totalCOGS;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      success: true,
      revenue,
      cogs: totalCOGS,
      profit,
      profitMargin
    };
  } catch (error: any) {
    console.error('Error calculating invoice profit:', error);
    return { success: false, error: error.message || error };
  }
}

