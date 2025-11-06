/**
 * تشغيل اختبار حقيقي للخدمات
 * Real Test Runner for Services
 * 
 * الخطوات:
 * 1. نفذ setup-test-data.sql في Supabase
 * 2. احصل على المعرفات من نتيجة السكربت
 * 3. ضعها في المتغيرات أدناه
 * 4. شغل: node run-real-test.cjs
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// قراءة config.json
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// =======================================
// ⚠️ المعرفات من قاعدة البيانات
// =======================================

const TEST_IDS = {
  org_id: '00000000-0000-0000-0000-000000000001',
  vendor_id: 'd570149e-480a-43fe-a288-aed316ab1a60',
  customer_id: '4da4242b-2c3b-406f-92dc-b07d2673657c',
  product_id: 'dfcfc164-2df9-4b14-9fe2-d40e4d5ae130', // pp500 - موجود مسبقاً
};

// =======================================
// إعداد Supabase Client
// =======================================

const supabaseUrl = config.SUPABASE_URL;
const supabaseKey = config.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ خطأ: بيانات Supabase غير موجودة في config.json');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// =======================================
// دالة مساعدة: تسجيل حركة مخزون (AVCO)
// =======================================

async function recordInventoryMovement(productId, quantity, unitCost, movementType, referenceType, referenceId) {
  try {
    // جلب المنتج الحالي
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('stock_quantity, cost_price')
      .eq('id', productId)
      .single();

    if (fetchError) throw fetchError;

    const oldQty = parseFloat(product.stock_quantity) || 0;
    const oldCost = parseFloat(product.cost_price) || 0;
    const newQty = parseFloat(quantity);
    const newCost = parseFloat(unitCost);

    let updatedQty, updatedCost;

    if (movementType === 'PURCHASE_IN') {
      // إضافة للمخزون مع تحديث AVCO
      updatedQty = oldQty + newQty;
      updatedCost = oldQty > 0 
        ? ((oldQty * oldCost) + (newQty * newCost)) / updatedQty
        : newCost;
    } else if (movementType === 'SALE_OUT') {
      // خصم من المخزون (بدون تغيير التكلفة)
      updatedQty = oldQty - newQty;
      updatedCost = oldCost;
    }

    // تحديث المنتج
    const { error: updateError } = await supabase
      .from('products')
      .update({
        stock_quantity: updatedQty,
        cost_price: updatedCost,
      })
      .eq('id', productId);

    if (updateError) throw updateError;

    console.log(`   📊 AVCO Update: ${oldQty.toFixed(2)} @ ${oldCost.toFixed(2)} → ${updatedQty.toFixed(2)} @ ${updatedCost.toFixed(2)}`);

    return { success: true, newQty: updatedQty, newCost: updatedCost };
  } catch (error) {
    console.error('❌ خطأ في recordInventoryMovement:', error.message);
    return { success: false, error: error.message };
  }
}

// =======================================
// دالة مساعدة: إنشاء قيد محاسبي
// =======================================

async function createJournalEntry(entryData, lines) {
  try {
    // التحقق من التوازن
    const totalDebit = lines.reduce((sum, line) => sum + parseFloat(line.debit_amount || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + parseFloat(line.credit_amount || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`القيد غير متوازن: مدين ${totalDebit} ≠ دائن ${totalCredit}`);
    }

    // توليد رقم القيد تلقائياً
    const entryDate = entryData.entry_date || new Date().toISOString().split('T')[0];
    const { data: entryNumberData, error: numberError } = await supabase
      .rpc('generate_entry_number', {
        p_org_id: TEST_IDS.org_id,
        p_entry_date: entryDate
      });

    if (numberError) throw numberError;
    const entryNumber = entryNumberData || `JE-${Date.now()}`;

    // إنشاء القيد
    const { data: entry, error: entryError } = await supabase
      .from('gl_entries')
      .insert({
        org_id: TEST_IDS.org_id,
        entry_number: entryNumber,
        ...entryData,
        total_debit: totalDebit,
        total_credit: totalCredit,
      })
      .select()
      .single();

    if (entryError) throw entryError;

    // إنشاء البنود
    const linesWithEntry = lines.map((line, index) => ({
      org_id: TEST_IDS.org_id,
      entry_id: entry.id,
      line_number: index + 1,
      ...line,
    }));

    const { error: linesError } = await supabase
      .from('gl_entry_lines')
      .insert(linesWithEntry);

    if (linesError) throw linesError;

    console.log(`   📝 Journal Entry Created: Dr ${totalDebit.toFixed(2)} / Cr ${totalCredit.toFixed(2)}`);
    return { success: true, entry };
  } catch (error) {
    console.error('❌ خطأ في createJournalEntry:', error.message);
    return { success: false, error: error.message };
  }
}

// =======================================
// اختبار 1: دورة المشتريات
// =======================================

async function testPurchasingCycle() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('🔄 اختبار دورة المشتريات');
  console.log('═══════════════════════════════════════════════\n');

  try {
    // 1. إنشاء أمر شراء
    console.log('1️⃣ إنشاء أمر شراء...');
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        org_id: TEST_IDS.org_id,
        order_number: `PO-${Date.now()}`,
        vendor_id: TEST_IDS.vendor_id,
        order_date: new Date().toISOString().split('T')[0],
        status: 'approved',
        subtotal: 5200.00,
        tax_amount: 780.00,
        total_amount: 5980.00,
      })
      .select()
      .single();

    if (poError) throw poError;
    console.log(`   ✅ تم إنشاء أمر الشراء: ${po.order_number}`);

    // إضافة بند
    const { error: lineError } = await supabase
      .from('purchase_order_lines')
      .insert({
        org_id: TEST_IDS.org_id,
        purchase_order_id: po.id,
        line_number: 1,
        product_id: TEST_IDS.product_id,
        quantity: 1000,
        unit_price: 5.20,
        tax_percentage: 15,
      });

    if (lineError) throw lineError;

    // 2. استلام البضائع
    console.log('\n2️⃣ استلام البضائع مع تحديث AVCO...');
    const { data: gr, error: grError } = await supabase
      .from('goods_receipts')
      .insert({
        org_id: TEST_IDS.org_id,
        receipt_number: `GR-${Date.now()}`,
        purchase_order_id: po.id,
        vendor_id: TEST_IDS.vendor_id,
        receipt_date: new Date().toISOString().split('T')[0],
        warehouse_location: 'المستودع الرئيسي',
        status: 'confirmed',
      })
      .select()
      .single();

    if (grError) throw grError;

    const { error: grLineError } = await supabase
      .from('goods_receipt_lines')
      .insert({
        org_id: TEST_IDS.org_id,
        goods_receipt_id: gr.id,
        product_id: TEST_IDS.product_id,
        ordered_quantity: 1000,
        received_quantity: 1000,
        unit_cost: 5.20,
        quality_status: 'accepted',
      });

    if (grLineError) throw grLineError;

    // تحديث AVCO
    const avcoResult = await recordInventoryMovement(
      TEST_IDS.product_id,
      1000,
      5.20,
      'PURCHASE_IN',
      'goods_receipt',
      gr.id
    );

    if (avcoResult.success) {
      console.log(`   ✅ تم استلام البضائع وتحديث AVCO`);
    }

    // تحديث حالة أمر الشراء
    await supabase
      .from('purchase_order_lines')
      .update({ received_quantity: 1000 })
      .eq('purchase_order_id', po.id);

    await supabase
      .from('purchase_orders')
      .update({ status: 'fully_received' })
      .eq('id', po.id);

    // 3. إنشاء فاتورة مورد
    console.log('\n3️⃣ إنشاء فاتورة مورد مع قيد محاسبي...');
    const { data: invoice, error: invError } = await supabase
      .from('supplier_invoices')
      .insert({
        org_id: TEST_IDS.org_id,
        invoice_number: `SINV-${Date.now()}`,
        vendor_id: TEST_IDS.vendor_id,
        purchase_order_id: po.id,
        goods_receipt_id: gr.id,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
        subtotal: 5200.00,
        tax_amount: 780.00,
        total_amount: 5980.00,
        status: 'approved',
      })
      .select()
      .single();

    if (invError) throw invError;

    // إنشاء القيد المحاسبي
    await createJournalEntry(
      {
        entry_date: new Date().toISOString().split('T')[0],
        entry_type: 'purchase',
        reference_type: 'supplier_invoice',
        reference_id: invoice.id,
        description: `فاتورة مورد ${invoice.invoice_number}`,
        status: 'posted',
      },
      [
        { account_code: '1130', description: 'مخزون', debit_amount: 5200.00, credit_amount: 0 },
        { account_code: '1161', description: 'ضريبة مدخلات', debit_amount: 780.00, credit_amount: 0 },
        { account_code: '2101', description: 'موردين', debit_amount: 0, credit_amount: 5980.00 },
      ]
    );

    console.log(`   ✅ تم إنشاء فاتورة المورد: ${invoice.invoice_number}`);

    console.log('\n✅ اكتملت دورة المشتريات بنجاح!');
    return { po, gr, invoice };
  } catch (error) {
    console.error('\n❌ خطأ في دورة المشتريات:', error.message);
    return null;
  }
}

// =======================================
// اختبار 2: دورة المبيعات
// =======================================

async function testSalesCycle() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('💰 اختبار دورة المبيعات');
  console.log('═══════════════════════════════════════════════\n');

  try {
    // 1. إنشاء فاتورة مبيعات
    console.log('1️⃣ إنشاء فاتورة مبيعات...');
    const { data: invoice, error: invError } = await supabase
      .from('sales_invoices')
      .insert({
        org_id: TEST_IDS.org_id,
        invoice_number: `SI-${Date.now()}`,
        customer_id: TEST_IDS.customer_id,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 10*24*60*60*1000).toISOString().split('T')[0],
        subtotal: 2100.00,
        tax_amount: 315.00,
        total_amount: 2415.00,
        delivery_status: 'pending',
        payment_status: 'unpaid',
      })
      .select()
      .single();

    if (invError) throw invError;

    // إضافة بند
    const { error: lineError } = await supabase
      .from('sales_invoice_lines')
      .insert({
        org_id: TEST_IDS.org_id,
        sales_invoice_id: invoice.id,
        line_number: 1,
        product_id: TEST_IDS.product_id,
        quantity: 300,
        unit_price: 7.00,
        tax_percentage: 15,
      });

    if (lineError) throw lineError;

    // إنشاء القيد المحاسبي للمبيعات
    await createJournalEntry(
      {
        entry_date: new Date().toISOString().split('T')[0],
        entry_type: 'sale',
        reference_type: 'sales_invoice',
        reference_id: invoice.id,
        description: `فاتورة مبيعات ${invoice.invoice_number}`,
        status: 'posted',
      },
      [
        { account_code: '1120', description: 'عملاء', debit_amount: 2415.00, credit_amount: 0 },
        { account_code: '4001', description: 'مبيعات', debit_amount: 0, credit_amount: 2100.00 },
        { account_code: '2162', description: 'ضريبة مخرجات', debit_amount: 0, credit_amount: 315.00 },
      ]
    );

    console.log(`   ✅ تم إنشاء فاتورة المبيعات: ${invoice.invoice_number}`);

    // 2. تسليم البضائع
    console.log('\n2️⃣ تسليم البضائع مع حساب COGS...');

    // جلب تكلفة المنتج الحالية (AVCO)
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('cost_price')
      .eq('id', TEST_IDS.product_id)
      .single();

    if (productError) throw productError;

    const unitCost = parseFloat(product.cost_price);
    const cogs = 300 * unitCost;

    const { data: dn, error: dnError } = await supabase
      .from('delivery_notes')
      .insert({
        org_id: TEST_IDS.org_id,
        delivery_number: `DN-${Date.now()}`,
        sales_invoice_id: invoice.id,
        customer_id: TEST_IDS.customer_id,
        delivery_date: new Date().toISOString().split('T')[0],
        status: 'delivered',
      })
      .select()
      .single();

    if (dnError) throw dnError;

    const { error: dnLineError } = await supabase
      .from('delivery_note_lines')
      .insert({
        org_id: TEST_IDS.org_id,
        delivery_note_id: dn.id,
        product_id: TEST_IDS.product_id,
        invoiced_quantity: 300,
        delivered_quantity: 300,
        unit_price: 7.00,
        unit_cost_at_delivery: unitCost,
      });

    if (dnLineError) throw dnLineError;

    // خصم المخزون
    await recordInventoryMovement(
      TEST_IDS.product_id,
      300,
      unitCost,
      'SALE_OUT',
      'delivery_note',
      dn.id
    );

    // تحديث بند الفاتورة بالتكلفة
    await supabase
      .from('sales_invoice_lines')
      .update({
        unit_cost_at_sale: unitCost,
        delivered_quantity: 300,
      })
      .eq('sales_invoice_id', invoice.id);

    // إنشاء قيد COGS
    await createJournalEntry(
      {
        entry_date: new Date().toISOString().split('T')[0],
        entry_type: 'cogs',
        reference_type: 'delivery_note',
        reference_id: dn.id,
        description: `تكلفة البضاعة المباعة - ${dn.delivery_number}`,
        status: 'posted',
      },
      [
        { account_code: '5001', description: 'تكلفة المبيعات', debit_amount: cogs, credit_amount: 0 },
        { account_code: '1130', description: 'مخزون', debit_amount: 0, credit_amount: cogs },
      ]
    );

    console.log(`   ✅ تم تسليم البضائع`);
    console.log(`   💰 COGS = 300 × ${unitCost.toFixed(2)} = ${cogs.toFixed(2)} SAR`);

    // تحديث حالة الفاتورة
    await supabase
      .from('sales_invoices')
      .update({ delivery_status: 'fully_delivered' })
      .eq('id', invoice.id);

    // 3. حساب الربح
    console.log('\n3️⃣ حساب الربح...');
    const revenue = 2100.00;
    const profit = revenue - cogs;
    const margin = (profit / revenue) * 100;

    console.log(`   💵 الإيرادات: ${revenue.toFixed(2)} SAR`);
    console.log(`   📦 التكلفة: ${cogs.toFixed(2)} SAR`);
    console.log(`   ✅ الربح: ${profit.toFixed(2)} SAR`);
    console.log(`   📊 نسبة الربح: ${margin.toFixed(2)}%`);

    console.log('\n✅ اكتملت دورة المبيعات بنجاح!');
    return { invoice, dn, profit, margin };
  } catch (error) {
    console.error('\n❌ خطأ في دورة المبيعات:', error.message);
    return null;
  }
}

// =======================================
// اختبار 3: التقارير المحاسبية
// =======================================

async function testReports() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('📊 التقارير المحاسبية');
  console.log('═══════════════════════════════════════════════\n');

  try {
    // ميزان المراجعة
    console.log('1️⃣ ميزان المراجعة...');
    const { data: entries, error } = await supabase
      .from('gl_entry_lines')
      .select('account_code, debit_amount, credit_amount')
      .eq('org_id', TEST_IDS.org_id);

    if (error) throw error;

    const balances = {};
    entries.forEach(line => {
      if (!balances[line.account_code]) {
        balances[line.account_code] = { debit: 0, credit: 0 };
      }
      balances[line.account_code].debit += parseFloat(line.debit_amount || 0);
      balances[line.account_code].credit += parseFloat(line.credit_amount || 0);
    });

    let totalDebit = 0;
    let totalCredit = 0;

    console.log('\n   الحساب          المدين          الدائن');
    console.log('   ─────────────────────────────────────────');
    Object.entries(balances).forEach(([account, bal]) => {
      console.log(`   ${account}       ${bal.debit.toFixed(2).padStart(12)}  ${bal.credit.toFixed(2).padStart(12)}`);
      totalDebit += bal.debit;
      totalCredit += bal.credit;
    });
    console.log('   ─────────────────────────────────────────');
    console.log(`   المجموع    ${totalDebit.toFixed(2).padStart(12)}  ${totalCredit.toFixed(2).padStart(12)}`);
    console.log(`\n   ${totalDebit === totalCredit ? '✅' : '❌'} متوازن: ${totalDebit.toFixed(2)} = ${totalCredit.toFixed(2)}`);

    console.log('\n✅ تم إنشاء التقارير بنجاح!');
  } catch (error) {
    console.error('\n❌ خطأ في التقارير:', error.message);
  }
}

// =======================================
// تشغيل جميع الاختبارات
// =======================================

async function runAllTests() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   اختبار كامل للمشتريات والمبيعات والمحاسبة  ║');
  console.log('╚═══════════════════════════════════════════════╝');

  // التحقق من المعرفات
  if (TEST_IDS.org_id.includes('PASTE') || 
      TEST_IDS.vendor_id.includes('PASTE') ||
      TEST_IDS.customer_id.includes('PASTE') ||
      TEST_IDS.product_id.includes('PASTE')) {
    console.error('\n❌ خطأ: يجب تحديث المعرفات في TEST_IDS');
    console.log('\nالخطوات:');
    console.log('1. نفذ setup-test-data.sql في Supabase');
    console.log('2. انسخ المعرفات من النتيجة');
    console.log('3. ضعها في TEST_IDS في بداية هذا الملف');
    console.log('4. شغل: node run-real-test.cjs\n');
    return;
  }

  console.log(`\n📋 استخدام المعرفات:`);
  console.log(`   Organization: ${TEST_IDS.org_id}`);
  console.log(`   Vendor: ${TEST_IDS.vendor_id}`);
  console.log(`   Customer: ${TEST_IDS.customer_id}`);
  console.log(`   Product: ${TEST_IDS.product_id}`);

  const purchaseResult = await testPurchasingCycle();
  if (purchaseResult) {
    const salesResult = await testSalesCycle();
    if (salesResult) {
      await testReports();
    }
  }

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║          ✅ اكتملت جميع الاختبارات!           ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('\n');
}

// تشغيل
runAllTests().catch(console.error);
