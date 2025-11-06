/**
 * خدمة المشتريات - Purchasing Service
 * تدير دورة المشتريات الكاملة مع تكامل AVCO والقيود المحاسبية
 */

import { supabase } from '../lib/supabase';
import { recordInventoryMovement } from '../domain/inventory';

// ===== TYPES =====

export interface PurchaseOrderLine {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_percentage?: number;
  notes?: string;
}

export interface PurchaseOrder {
  id?: string;
  order_number?: string;
  vendor_id: string;
  order_date: string;
  expected_delivery_date?: string;
  status: 'draft' | 'submitted' | 'approved' | 'partially_received' | 'fully_received' | 'cancelled';
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  notes?: string;
  lines: PurchaseOrderLine[];
}

export interface GoodsReceipt {
  id?: string;
  receipt_number?: string;
  purchase_order_id: string;
  vendor_id: string;
  receipt_date: string;
  warehouse_location?: string;
  receiver_name?: string;
  notes?: string;
}

export interface GoodsReceiptLine {
  product_id: string;
  ordered_quantity: number;
  received_quantity: number;
  unit_cost: number;
  quality_status: 'accepted' | 'rejected' | 'pending_inspection';
  notes?: string;
}

export interface SupplierInvoice {
  id?: string;
  invoice_number: string;
  vendor_id: string;
  purchase_order_id?: string;
  goods_receipt_id?: string;
  invoice_date: string;
  due_date: string;
  payment_terms?: string;
  subtotal: number;
  discount_amount?: number;
  tax_amount: number;
  total_amount: number;
  paid_amount?: number;
  status: 'draft' | 'submitted' | 'approved' | 'paid' | 'partially_paid' | 'overdue';
  notes?: string;
  lines: SupplierInvoiceLine[];
}

export interface SupplierInvoiceLine {
  product_id: string;
  goods_receipt_line_id?: string;
  quantity: number;
  unit_cost: number;
  discount_percentage?: number;
  tax_percentage?: number;
  notes?: string;
}

// ===== PURCHASE ORDER FUNCTIONS =====

/**
 * إنشاء أمر شراء جديد
 */
export async function createPurchaseOrder(order: PurchaseOrder) {
  try {
    // 1. حساب الإجماليات
    let subtotal = 0;
    let discountAmount = 0;
    let taxAmount = 0;

    order.lines.forEach(line => {
      const lineSubtotal = line.quantity * line.unit_price;
      const lineDiscount = lineSubtotal * (line.discount_percentage || 0) / 100;
      const lineAfterDiscount = lineSubtotal - lineDiscount;
      const lineTax = lineAfterDiscount * (line.tax_percentage || 0) / 100;

      subtotal += lineSubtotal;
      discountAmount += lineDiscount;
      taxAmount += lineTax;
    });

    const totalAmount = subtotal - discountAmount + taxAmount;

    // 2. إنشاء أمر الشراء
    const { data: poData, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        vendor_id: order.vendor_id,
        order_date: order.order_date,
        expected_delivery_date: order.expected_delivery_date,
        status: order.status || 'draft',
        subtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        notes: order.notes,
      })
      .select()
      .single();

    if (poError) throw poError;

    // 3. إنشاء سطور أمر الشراء
    const linesWithPOId = order.lines.map(line => ({
      purchase_order_id: poData.id,
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount_percentage: line.discount_percentage || 0,
      tax_percentage: line.tax_percentage || 0,
      notes: line.notes,
    }));

    const { error: linesError } = await supabase
      .from('purchase_order_lines')
      .insert(linesWithPOId);

    if (linesError) throw linesError;

    return { success: true, data: poData };
  } catch (error) {
    console.error('Error creating purchase order:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على أمر شراء مع تفاصيله
 */
export async function getPurchaseOrderWithDetails(orderId: string) {
  try {
    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        vendor:vendors(*),
        lines:purchase_order_lines(
          *,
          product:products(*)
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError) throw orderError;

    return { success: true, data: order };
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    return { success: false, error };
  }
}

/**
 * تحديث حالة أمر الشراء
 */
export async function updatePurchaseOrderStatus(orderId: string, status: string) {
  try {
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status })
      .eq('id', orderId)
      .select()
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error updating purchase order status:', error);
    return { success: false, error };
  }
}

// ===== GOODS RECEIPT FUNCTIONS =====

/**
 * استلام بضائع (مع تحديث AVCO للمخزون)
 * هذه الوظيفة حاسمة لأنها تحدث المتوسط المرجح للتكلفة
 */
export async function receiveGoods(
  receipt: GoodsReceipt,
  lines: GoodsReceiptLine[]
) {
  try {
    // 1. إنشاء سند الاستلام
    const { data: grData, error: grError } = await supabase
      .from('goods_receipts')
      .insert({
        purchase_order_id: receipt.purchase_order_id,
        vendor_id: receipt.vendor_id,
        receipt_date: receipt.receipt_date,
        warehouse_location: receipt.warehouse_location,
        receiver_name: receipt.receiver_name,
        notes: receipt.notes,
      })
      .select()
      .single();

    if (grError) throw grError;

    // 2. إنشاء سطور الاستلام وتحديث المخزون بـ AVCO
    for (const line of lines) {
      // إدراج سطر الاستلام
      const { error: lineError } = await supabase
        .from('goods_receipt_lines')
        .insert({
          goods_receipt_id: grData.id,
          purchase_order_line_id: line.product_id, // يجب تمرير purchase_order_line_id الفعلي
          product_id: line.product_id,
          ordered_quantity: line.ordered_quantity,
          received_quantity: line.received_quantity,
          unit_cost: line.unit_cost,
          quality_status: line.quality_status,
          notes: line.notes,
        });

      if (lineError) throw lineError;

      // تحديث المخزون باستخدام AVCO (فقط للكميات المقبولة)
      if (line.quality_status === 'accepted' && line.received_quantity > 0) {
        const inventoryResult = await recordInventoryMovement({
          itemId: line.product_id,
          moveType: 'PURCHASE_IN',
          qtyIn: line.received_quantity,
          qtyOut: 0,
          unitCost: line.unit_cost,
          referenceType: 'GOODS_RECEIPT',
          referenceId: grData.id,
          notes: `استلام بضائع - ${grData.receipt_number || grData.id}`,
        });

        if (!inventoryResult.success) {
          throw new Error(`فشل تحديث المخزون للمنتج ${line.product_id}: ${inventoryResult.error}`);
        }

        console.log(`✅ تم تحديث AVCO للمنتج ${line.product_id}:`, inventoryResult.data);
      }
    }

    // 3. تحديث حالة أمر الشراء
    // فحص إذا تم استلام كل الكميات
    const { data: poLines } = await supabase
      .from('purchase_order_lines')
      .select('quantity, received_quantity')
      .eq('purchase_order_id', receipt.purchase_order_id);

    let allReceived = true;
    let anyReceived = false;

    if (poLines) {
      for (const poLine of poLines) {
        if ((poLine.received_quantity || 0) < poLine.quantity) {
          allReceived = false;
        }
        if ((poLine.received_quantity || 0) > 0) {
          anyReceived = true;
        }
      }
    }

    const newStatus = allReceived ? 'fully_received' : (anyReceived ? 'partially_received' : 'approved');
    await updatePurchaseOrderStatus(receipt.purchase_order_id, newStatus);

    return { success: true, data: grData };
  } catch (error) {
    console.error('Error receiving goods:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على سند استلام مع تفاصيله
 */
export async function getGoodsReceiptWithDetails(receiptId: string) {
  try {
    const { data, error } = await supabase
      .from('goods_receipts')
      .select(`
        *,
        vendor:vendors(*),
        purchase_order:purchase_orders(*),
        lines:goods_receipt_lines(
          *,
          product:products(*)
        )
      `)
      .eq('id', receiptId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching goods receipt:', error);
    return { success: false, error };
  }
}

// ===== SUPPLIER INVOICE FUNCTIONS =====

/**
 * إنشاء فاتورة مورد (مع القيود المحاسبية)
 */
export async function createSupplierInvoice(invoice: SupplierInvoice) {
  try {
    // 1. إنشاء الفاتورة
    const { data: invData, error: invError } = await supabase
      .from('supplier_invoices')
      .insert({
        invoice_number: invoice.invoice_number,
        vendor_id: invoice.vendor_id,
        purchase_order_id: invoice.purchase_order_id,
        goods_receipt_id: invoice.goods_receipt_id,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        payment_terms: invoice.payment_terms,
        subtotal: invoice.subtotal,
        discount_amount: invoice.discount_amount || 0,
        tax_amount: invoice.tax_amount,
        total_amount: invoice.total_amount,
        paid_amount: invoice.paid_amount || 0,
        status: invoice.status || 'draft',
        notes: invoice.notes,
      })
      .select()
      .single();

    if (invError) throw invError;

    // 2. إنشاء سطور الفاتورة
    const linesWithInvId = invoice.lines.map(line => ({
      supplier_invoice_id: invData.id,
      product_id: line.product_id,
      goods_receipt_line_id: line.goods_receipt_line_id,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
      discount_percentage: line.discount_percentage || 0,
      tax_percentage: line.tax_percentage || 0,
      notes: line.notes,
    }));

    const { error: linesError } = await supabase
      .from('supplier_invoice_lines')
      .insert(linesWithInvId);

    if (linesError) throw linesError;

    // 3. إنشاء القيد المحاسبي (إذا كانت الفاتورة معتمدة)
    if (invoice.status === 'approved' || invoice.status === 'submitted') {
      await createPurchaseGLEntry(invData);
    }

    return { success: true, data: invData };
  } catch (error) {
    console.error('Error creating supplier invoice:', error);
    return { success: false, error };
  }
}

/**
 * إنشاء القيد المحاسبي للمشتريات
 * من مدين: حساب المخزون (1130)
 * من مدين: ضريبة مدخلات (1161)
 * إلى دائن: حساب الموردين (2101)
 */
async function createPurchaseGLEntry(invoice: any) {
  try {
    const entries = [];
    const invAmount = invoice.total_amount - invoice.tax_amount;
    
    // مدين: المخزون
    entries.push({
      account_code: '1130',
      account_name: 'المخزون',
      debit: invAmount,
      credit: 0,
      description: `فاتورة مورد ${invoice.invoice_number}`,
      reference_type: 'SUPPLIER_INVOICE',
      reference_id: invoice.id,
      transaction_date: invoice.invoice_date,
    });

    // مدين: ضريبة القيمة المضافة (مدخلات)
    if (invoice.tax_amount > 0) {
      entries.push({
        account_code: '1161',
        account_name: 'ضريبة القيمة المضافة - مدخلات',
        debit: invoice.tax_amount,
        credit: 0,
        description: `ضريبة فاتورة ${invoice.invoice_number}`,
        reference_type: 'SUPPLIER_INVOICE',
        reference_id: invoice.id,
        transaction_date: invoice.invoice_date,
      });
    }

    // دائن: حساب الموردين
    entries.push({
      account_code: '2101',
      account_name: 'حسابات دائنة - موردين',
      debit: 0,
      credit: invoice.total_amount,
      description: `فاتورة مورد ${invoice.invoice_number}`,
      reference_type: 'SUPPLIER_INVOICE',
      reference_id: invoice.id,
      transaction_date: invoice.invoice_date,
    });

    // إدراج القيود في جدول gl_entries
    const { error } = await supabase
      .from('gl_entries')
      .insert(entries);

    if (error) {
      console.error('Error creating GL entries:', error);
      throw error;
    }

    console.log(`✅ تم إنشاء القيد المحاسبي للفاتورة ${invoice.invoice_number}`);
    return { success: true };
  } catch (error) {
    console.error('Error in createPurchaseGLEntry:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على فاتورة مورد مع تفاصيلها
 */
export async function getSupplierInvoiceWithDetails(invoiceId: string) {
  try {
    const { data, error } = await supabase
      .from('supplier_invoices')
      .select(`
        *,
        vendor:vendors(*),
        purchase_order:purchase_orders(*),
        goods_receipt:goods_receipts(*),
        lines:supplier_invoice_lines(
          *,
          product:products(*)
        )
      `)
      .eq('id', invoiceId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching supplier invoice:', error);
    return { success: false, error };
  }
}

/**
 * تسجيل دفعة لفاتورة مورد
 */
export async function recordSupplierPayment(invoiceId: string, paymentAmount: number, paymentDate: string) {
  try {
    // 1. الحصول على الفاتورة
    const { data: invoice, error: fetchError } = await supabase
      .from('supplier_invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (fetchError) throw fetchError;

    // 2. حساب المبلغ المدفوع الجديد
    const newPaidAmount = (invoice.paid_amount || 0) + paymentAmount;
    const balance = invoice.total_amount - newPaidAmount;

    // 3. تحديد الحالة الجديدة
    let newStatus = invoice.status;
    if (balance === 0) {
      newStatus = 'paid';
    } else if (newPaidAmount > 0 && balance > 0) {
      newStatus = 'partially_paid';
    }

    // 4. تحديث الفاتورة
    const { error: updateError } = await supabase
      .from('supplier_invoices')
      .update({
        paid_amount: newPaidAmount,
        status: newStatus,
      })
      .eq('id', invoiceId);

    if (updateError) throw updateError;

    // 5. إنشاء قيد الدفع
    const paymentEntries = [
      // مدين: حساب الموردين
      {
        account_code: '2101',
        account_name: 'حسابات دائنة - موردين',
        debit: paymentAmount,
        credit: 0,
        description: `دفعة لفاتورة ${invoice.invoice_number}`,
        reference_type: 'SUPPLIER_PAYMENT',
        reference_id: invoiceId,
        transaction_date: paymentDate,
      },
      // دائن: النقدية أو البنك
      {
        account_code: '1110',
        account_name: 'النقدية',
        debit: 0,
        credit: paymentAmount,
        description: `دفعة لفاتورة ${invoice.invoice_number}`,
        reference_type: 'SUPPLIER_PAYMENT',
        reference_id: invoiceId,
        transaction_date: paymentDate,
      },
    ];

    const { error: glError } = await supabase
      .from('gl_entries')
      .insert(paymentEntries);

    if (glError) throw glError;

    console.log(`✅ تم تسجيل دفعة بمبلغ ${paymentAmount} للفاتورة ${invoice.invoice_number}`);
    return { success: true, balance, newStatus };
  } catch (error) {
    console.error('Error recording supplier payment:', error);
    return { success: false, error };
  }
}

// ===== HELPER FUNCTIONS =====

/**
 * الحصول على جميع أوامر الشراء
 */
export async function getAllPurchaseOrders(filters?: { status?: string; vendor_id?: string }) {
  try {
    let query = supabase
      .from('purchase_orders')
      .select(`
        *,
        vendor:vendors(*)
      `)
      .order('order_date', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على جميع سندات الاستلام
 */
export async function getAllGoodsReceipts(filters?: { vendor_id?: string }) {
  try {
    let query = supabase
      .from('goods_receipts')
      .select(`
        *,
        vendor:vendors(*),
        purchase_order:purchase_orders(*)
      `)
      .order('receipt_date', { ascending: false });

    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching goods receipts:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على جميع فواتير الموردين
 */
export async function getAllSupplierInvoices(filters?: { status?: string; vendor_id?: string }) {
  try {
    let query = supabase
      .from('supplier_invoices')
      .select(`
        *,
        vendor:vendors(*)
      `)
      .order('invoice_date', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching supplier invoices:', error);
    return { success: false, error };
  }
}
