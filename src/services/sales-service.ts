/**
 * خدمة المبيعات - Sales Service
 * تدير دورة المبيعات الكاملة مع احتساب COGS والقيود المحاسبية
 */

import { supabase } from '../lib/supabase';
import { recordInventoryMovement } from '../domain/inventory';

// ===== TYPES =====

export interface SalesInvoiceLine {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_percentage?: number;
  notes?: string;
}

export interface SalesInvoice {
  id?: string;
  invoice_number: string;
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

export interface DeliveryNote {
  id?: string;
  delivery_number?: string;
  sales_invoice_id: string;
  customer_id: string;
  delivery_date: string;
  vehicle_number?: string;
  driver_name?: string;
  notes?: string;
}

export interface DeliveryNoteLine {
  product_id: string;
  invoiced_quantity: number;
  delivered_quantity: number;
  unit_price: number;
  notes?: string;
}

// ===== SALES INVOICE FUNCTIONS =====

/**
 * إنشاء فاتورة مبيعات جديدة (مع القيود المحاسبية)
 */
export async function createSalesInvoice(invoice: SalesInvoice) {
  try {
    // 1. التحقق من توفر المخزون لكل منتج
    for (const line of invoice.lines) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('quantity_in_stock, name')
        .eq('id', line.product_id)
        .single();

      if (productError) throw productError;

      if (product.quantity_in_stock < line.quantity) {
        throw new Error(`المخزون غير كافٍ للمنتج "${product.name}". المتوفر: ${product.quantity_in_stock}, المطلوب: ${line.quantity}`);
      }
    }

    // 2. إنشاء الفاتورة
    const { data: invData, error: invError } = await supabase
      .from('sales_invoices')
      .insert({
        invoice_number: invoice.invoice_number,
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
        notes: invoice.notes,
      })
      .select()
      .single();

    if (invError) throw invError;

    // 3. إنشاء سطور الفاتورة
    const linesWithInvId = invoice.lines.map(line => ({
      sales_invoice_id: invData.id,
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount_percentage: line.discount_percentage || 0,
      tax_percentage: line.tax_percentage || 0,
      notes: line.notes,
    }));

    const { error: linesError } = await supabase
      .from('sales_invoice_lines')
      .insert(linesWithInvId);

    if (linesError) throw linesError;

    // 4. إنشاء القيد المحاسبي للمبيعات
    await createSalesGLEntry(invData);

    return { success: true, data: invData };
  } catch (error) {
    console.error('Error creating sales invoice:', error);
    return { success: false, error };
  }
}

/**
 * إنشاء القيد المحاسبي للمبيعات
 * من مدين: حساب العملاء (1120)
 * إلى دائن: إيرادات المبيعات (4001)
 * إلى دائن: ضريبة مخرجات (2162)
 */
async function createSalesGLEntry(invoice: any) {
  try {
    const entries = [];
    const revenueAmount = invoice.total_amount - invoice.tax_amount;

    // مدين: حساب العملاء (المدينون)
    entries.push({
      account_code: '1120',
      account_name: 'حسابات مدينة - عملاء',
      debit: invoice.total_amount,
      credit: 0,
      description: `فاتورة مبيعات ${invoice.invoice_number}`,
      reference_type: 'SALES_INVOICE',
      reference_id: invoice.id,
      transaction_date: invoice.invoice_date,
    });

    // دائن: إيرادات المبيعات
    entries.push({
      account_code: '4001',
      account_name: 'إيرادات المبيعات',
      debit: 0,
      credit: revenueAmount,
      description: `فاتورة مبيعات ${invoice.invoice_number}`,
      reference_type: 'SALES_INVOICE',
      reference_id: invoice.id,
      transaction_date: invoice.invoice_date,
    });

    // دائن: ضريبة القيمة المضافة (مخرجات)
    if (invoice.tax_amount > 0) {
      entries.push({
        account_code: '2162',
        account_name: 'ضريبة القيمة المضافة - مخرجات',
        debit: 0,
        credit: invoice.tax_amount,
        description: `ضريبة فاتورة ${invoice.invoice_number}`,
        reference_type: 'SALES_INVOICE',
        reference_id: invoice.id,
        transaction_date: invoice.invoice_date,
      });
    }

    // إدراج القيود
    const { error } = await supabase
      .from('gl_entries')
      .insert(entries);

    if (error) {
      console.error('Error creating sales GL entries:', error);
      throw error;
    }

    console.log(`✅ تم إنشاء القيد المحاسبي لفاتورة المبيعات ${invoice.invoice_number}`);
    return { success: true };
  } catch (error) {
    console.error('Error in createSalesGLEntry:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على فاتورة مبيعات مع تفاصيلها
 */
export async function getSalesInvoiceWithDetails(invoiceId: string) {
  try {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(*),
        lines:sales_invoice_lines(
          *,
          product:products(*)
        )
      `)
      .eq('id', invoiceId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching sales invoice:', error);
    return { success: false, error };
  }
}

// ===== DELIVERY NOTE FUNCTIONS =====

/**
 * تسليم بضائع (مع خصم المخزون AVCO وحساب COGS)
 * هذه الوظيفة حاسمة لأنها:
 * 1. تخصم الكمية من المخزون
 * 2. تحتسب تكلفة البضاعة المباعة COGS باستخدام AVCO
 * 3. تنشئ قيد COGS المحاسبي
 */
export async function deliverGoods(
  delivery: DeliveryNote,
  lines: DeliveryNoteLine[]
) {
  try {
    // 1. إنشاء سند التسليم
    const { data: dnData, error: dnError } = await supabase
      .from('delivery_notes')
      .insert({
        sales_invoice_id: delivery.sales_invoice_id,
        customer_id: delivery.customer_id,
        delivery_date: delivery.delivery_date,
        vehicle_number: delivery.vehicle_number,
        driver_name: delivery.driver_name,
        notes: delivery.notes,
      })
      .select()
      .single();

    if (dnError) throw dnError;

    let totalCOGS = 0;

    // 2. معالجة كل سطر تسليم
    for (const line of lines) {
      // الحصول على تكلفة المنتج الحالية (AVCO)
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('cost_price, quantity_in_stock, name')
        .eq('id', line.product_id)
        .single();

      if (productError) throw productError;

      // التحقق من المخزون
      if (product.quantity_in_stock < line.delivered_quantity) {
        throw new Error(`المخزون غير كافٍ للمنتج "${product.name}"`);
      }

      const unitCostAtDelivery = product.cost_price;
      const lineCOGS = line.delivered_quantity * unitCostAtDelivery;
      totalCOGS += lineCOGS;

      // إدراج سطر التسليم
      const { error: lineError } = await supabase
        .from('delivery_note_lines')
        .insert({
          delivery_note_id: dnData.id,
          sales_invoice_line_id: line.product_id, // يجب تمرير sales_invoice_line_id الفعلي
          product_id: line.product_id,
          invoiced_quantity: line.invoiced_quantity,
          delivered_quantity: line.delivered_quantity,
          unit_price: line.unit_price,
          unit_cost_at_delivery: unitCostAtDelivery,
          notes: line.notes,
        });

      if (lineError) throw lineError;

      // خصم المخزون (تحديث AVCO)
      const inventoryResult = await recordInventoryMovement({
        itemId: line.product_id,
        moveType: 'SALE_OUT',
        qtyIn: 0,
        qtyOut: line.delivered_quantity,
        unitCost: unitCostAtDelivery,
        referenceType: 'DELIVERY_NOTE',
        referenceId: dnData.id,
        notes: `تسليم بضاعة - ${dnData.delivery_number || dnData.id}`,
      });

      if (!inventoryResult.success) {
        throw new Error(`فشل خصم المخزون للمنتج ${line.product_id}: ${inventoryResult.error}`);
      }

      console.log(`✅ تم خصم ${line.delivered_quantity} من المنتج ${line.product_id} بتكلفة ${unitCostAtDelivery} (COGS: ${lineCOGS})`);
    }

    // 3. إنشاء قيد COGS المحاسبي
    await createCOGSGLEntry(dnData, totalCOGS);

    // 4. تحديث حالة التسليم في الفاتورة
    const { data: invoiceLines } = await supabase
      .from('sales_invoice_lines')
      .select('quantity, delivered_quantity')
      .eq('sales_invoice_id', delivery.sales_invoice_id);

    let allDelivered = true;
    let anyDelivered = false;

    if (invoiceLines) {
      for (const invLine of invoiceLines) {
        if ((invLine.delivered_quantity || 0) < invLine.quantity) {
          allDelivered = false;
        }
        if ((invLine.delivered_quantity || 0) > 0) {
          anyDelivered = true;
        }
      }
    }

    const newDeliveryStatus = allDelivered ? 'fully_delivered' : (anyDelivered ? 'partially_delivered' : 'pending');
    await supabase
      .from('sales_invoices')
      .update({ delivery_status: newDeliveryStatus })
      .eq('id', delivery.sales_invoice_id);

    return { success: true, data: dnData, totalCOGS };
  } catch (error) {
    console.error('Error delivering goods:', error);
    return { success: false, error };
  }
}

/**
 * إنشاء قيد COGS المحاسبي
 * من مدين: تكلفة البضاعة المباعة (5001)
 * إلى دائن: المخزون (1130)
 */
async function createCOGSGLEntry(deliveryNote: any, totalCOGS: number) {
  try {
    const entries = [
      // مدين: تكلفة البضاعة المباعة (COGS)
      {
        account_code: '5001',
        account_name: 'تكلفة البضاعة المباعة',
        debit: totalCOGS,
        credit: 0,
        description: `تكلفة بضاعة مباعة - ${deliveryNote.delivery_number || deliveryNote.id}`,
        reference_type: 'DELIVERY_NOTE',
        reference_id: deliveryNote.id,
        transaction_date: deliveryNote.delivery_date,
      },
      // دائن: المخزون
      {
        account_code: '1130',
        account_name: 'المخزون',
        debit: 0,
        credit: totalCOGS,
        description: `تكلفة بضاعة مباعة - ${deliveryNote.delivery_number || deliveryNote.id}`,
        reference_type: 'DELIVERY_NOTE',
        reference_id: deliveryNote.id,
        transaction_date: deliveryNote.delivery_date,
      },
    ];

    const { error } = await supabase
      .from('gl_entries')
      .insert(entries);

    if (error) {
      console.error('Error creating COGS GL entries:', error);
      throw error;
    }

    console.log(`✅ تم إنشاء قيد COGS بمبلغ ${totalCOGS} ريال`);
    return { success: true };
  } catch (error) {
    console.error('Error in createCOGSGLEntry:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على سند تسليم مع تفاصيله
 */
export async function getDeliveryNoteWithDetails(deliveryId: string) {
  try {
    const { data, error } = await supabase
      .from('delivery_notes')
      .select(`
        *,
        customer:customers(*),
        sales_invoice:sales_invoices(*),
        lines:delivery_note_lines(
          *,
          product:products(*)
        )
      `)
      .eq('id', deliveryId)
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching delivery note:', error);
    return { success: false, error };
  }
}

// ===== COLLECTION FUNCTIONS =====

/**
 * تسجيل تحصيل من عميل
 */
export async function recordCustomerCollection(
  invoiceId: string,
  collectionAmount: number,
  collectionDate: string,
  paymentMethod: 'cash' | 'bank' | 'check' = 'cash'
) {
  try {
    // 1. الحصول على الفاتورة
    const { data: invoice, error: fetchError } = await supabase
      .from('sales_invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (fetchError) throw fetchError;

    // 2. حساب المبلغ المحصل الجديد
    const newPaidAmount = (invoice.paid_amount || 0) + collectionAmount;
    const balance = invoice.total_amount - newPaidAmount;

    // 3. تحديد الحالة الجديدة
    let newStatus: 'paid' | 'partially_paid' | 'unpaid' = 'unpaid';
    if (balance === 0) {
      newStatus = 'paid';
    } else if (newPaidAmount > 0 && balance > 0) {
      newStatus = 'partially_paid';
    }

    // 4. تحديث الفاتورة
    const { error: updateError } = await supabase
      .from('sales_invoices')
      .update({
        paid_amount: newPaidAmount,
        payment_status: newStatus,
      })
      .eq('id', invoiceId);

    if (updateError) throw updateError;

    // 5. إنشاء قيد التحصيل
    const accountCode = paymentMethod === 'cash' ? '1110' : '1111';
    const accountName = paymentMethod === 'cash' ? 'النقدية' : 'البنك';

    const collectionEntries = [
      // مدين: النقدية أو البنك
      {
        account_code: accountCode,
        account_name: accountName,
        debit: collectionAmount,
        credit: 0,
        description: `تحصيل من فاتورة ${invoice.invoice_number}`,
        reference_type: 'CUSTOMER_COLLECTION',
        reference_id: invoiceId,
        transaction_date: collectionDate,
      },
      // دائن: حساب العملاء
      {
        account_code: '1120',
        account_name: 'حسابات مدينة - عملاء',
        debit: 0,
        credit: collectionAmount,
        description: `تحصيل من فاتورة ${invoice.invoice_number}`,
        reference_type: 'CUSTOMER_COLLECTION',
        reference_id: invoiceId,
        transaction_date: collectionDate,
      },
    ];

    const { error: glError } = await supabase
      .from('gl_entries')
      .insert(collectionEntries);

    if (glError) throw glError;

    console.log(`✅ تم تسجيل تحصيل بمبلغ ${collectionAmount} من الفاتورة ${invoice.invoice_number}`);
    return { success: true, balance, newStatus };
  } catch (error) {
    console.error('Error recording customer collection:', error);
    return { success: false, error };
  }
}

// ===== HELPER FUNCTIONS =====

/**
 * الحصول على جميع فواتير المبيعات
 */
export async function getAllSalesInvoices(filters?: { 
  payment_status?: string; 
  delivery_status?: string;
  customer_id?: string;
}) {
  try {
    let query = supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(*)
      `)
      .order('invoice_date', { ascending: false });

    if (filters?.payment_status) {
      query = query.eq('payment_status', filters.payment_status);
    }
    if (filters?.delivery_status) {
      query = query.eq('delivery_status', filters.delivery_status);
    }
    if (filters?.customer_id) {
      query = query.eq('customer_id', filters.customer_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching sales invoices:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على جميع سندات التسليم
 */
export async function getAllDeliveryNotes(filters?: { customer_id?: string }) {
  try {
    let query = supabase
      .from('delivery_notes')
      .select(`
        *,
        customer:customers(*),
        sales_invoice:sales_invoices(*)
      `)
      .order('delivery_date', { ascending: false });

    if (filters?.customer_id) {
      query = query.eq('customer_id', filters.customer_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching delivery notes:', error);
    return { success: false, error };
  }
}

/**
 * حساب إجمالي الربح من فاتورة
 */
export async function calculateInvoiceProfit(invoiceId: string) {
  try {
    // الحصول على الفاتورة
    const { data: invoice } = await supabase
      .from('sales_invoices')
      .select('total_amount, tax_amount')
      .eq('id', invoiceId)
      .single();

    if (!invoice) throw new Error('الفاتورة غير موجودة');

    // الحصول على سندات التسليم المرتبطة
    const { data: deliveries } = await supabase
      .from('delivery_notes')
      .select(`
        id,
        lines:delivery_note_lines(
          delivered_quantity,
          unit_cost_at_delivery
        )
      `)
      .eq('sales_invoice_id', invoiceId);

    if (!deliveries) return { success: true, revenue: 0, cogs: 0, profit: 0 };

    // حساب COGS الفعلي من سندات التسليم
    let totalCOGS = 0;
    deliveries.forEach((delivery: any) => {
      delivery.lines.forEach((line: any) => {
        totalCOGS += line.delivered_quantity * line.unit_cost_at_delivery;
      });
    });

    const revenue = invoice.total_amount - invoice.tax_amount;
    const profit = revenue - totalCOGS;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      success: true,
      revenue,
      cogs: totalCOGS,
      profit,
      profitMargin,
      tax: invoice.tax_amount,
    };
  } catch (error) {
    console.error('Error calculating invoice profit:', error);
    return { success: false, error };
  }
}
