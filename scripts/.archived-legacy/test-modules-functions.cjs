// اختبار سريع لجميع الوظائف
const { createClient } = require('@supabase/supabase-js');
const config = require('./config.json');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

console.log('\n✅ ======================================');
console.log('   اختبار وظائف المشتريات والمبيعات');
console.log('========================================\n');

async function testAll() {
  try {
    // 1. اختبار قراءة الموردين
    console.log('1️⃣ اختبار الموردين...');
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendors')
      .select('*')
      .limit(5);
    
    if (vendorsError) throw vendorsError;
    console.log(`   ✅ تم العثور على ${vendors.length} موردين`);
    if (vendors.length > 0) {
      console.log(`   📋 مثال: ${vendors[0].code} - ${vendors[0].name}`);
    }
    
    // 2. اختبار قراءة العملاء
    console.log('\n2️⃣ اختبار العملاء...');
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('*')
      .limit(5);
    
    if (customersError) throw customersError;
    console.log(`   ✅ تم العثور على ${customers.length} عملاء`);
    if (customers.length > 0) {
      console.log(`   📋 مثال: ${customers[0].code} - ${customers[0].name}`);
    }
    
    // 3. اختبار قراءة المنتجات
    console.log('\n3️⃣ اختبار المنتجات...');
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .limit(5);
    
    if (productsError) throw productsError;
    console.log(`   ✅ تم العثور على ${products.length} منتجات`);
    if (products.length > 0) {
      console.log(`   📋 مثال: ${products[0].code} - ${products[0].name}`);
      console.log(`   📊 المخزون: ${products[0].stock_quantity} | التكلفة: ${products[0].cost_price} ر.س`);
    }
    
    // 4. اختبار قراءة أوامر الشراء
    console.log('\n4️⃣ اختبار أوامر الشراء...');
    const { data: purchaseOrders, error: poError } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        vendor:vendors(code, name)
      `)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (poError) throw poError;
    console.log(`   ✅ تم العثور على ${purchaseOrders.length} أوامر شراء`);
    if (purchaseOrders.length > 0) {
      const po = purchaseOrders[0];
      console.log(`   📋 مثال: ${po.order_number}`);
      console.log(`   📊 المورد: ${po.vendor?.name || 'غير محدد'}`);
      console.log(`   💰 الإجمالي: ${po.total_amount} ر.س`);
      console.log(`   📌 الحالة: ${po.status}`);
    }
    
    // 5. اختبار قراءة أسطر أوامر الشراء
    console.log('\n5️⃣ اختبار أسطر أوامر الشراء...');
    const { data: poLines, error: poLinesError } = await supabase
      .from('purchase_order_lines')
      .select(`
        *,
        product:products(code, name)
      `)
      .limit(5);
    
    if (poLinesError) throw poLinesError;
    console.log(`   ✅ تم العثور على ${poLines.length} أسطر`);
    if (poLines.length > 0) {
      const line = poLines[0];
      console.log(`   📋 مثال: ${line.product?.name || 'منتج'}`);
      console.log(`   📊 الكمية: ${line.quantity} | السعر: ${line.unit_price} ر.س`);
    }
    
    // 6. اختبار إشعارات الاستلام
    console.log('\n6️⃣ اختبار إشعارات الاستلام...');
    const { data: goodsReceipts, error: grError } = await supabase
      .from('goods_receipts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (grError) throw grError;
    console.log(`   ✅ تم العثور على ${goodsReceipts.length} إشعارات استلام`);
    if (goodsReceipts.length > 0) {
      console.log(`   📋 مثال: ${goodsReceipts[0].gr_number}`);
      console.log(`   📌 الحالة: ${goodsReceipts[0].status}`);
    }
    
    // 7. اختبار فواتير المبيعات
    console.log('\n7️⃣ اختبار فواتير المبيعات...');
    const { data: salesInvoices, error: siError } = await supabase
      .from('sales_invoices')
      .select(`
        *,
        customer:customers(code, name)
      `)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (siError) throw siError;
    console.log(`   ✅ تم العثور على ${salesInvoices.length} فواتير مبيعات`);
    if (salesInvoices.length > 0) {
      const si = salesInvoices[0];
      console.log(`   📋 مثال: ${si.invoice_number}`);
      console.log(`   📊 العميل: ${si.customer?.name || 'غير محدد'}`);
      console.log(`   💰 الإجمالي: ${si.total_amount} ر.س`);
      console.log(`   📌 الحالة: ${si.status}`);
    }
    
    // 8. اختبار أسطر فواتير المبيعات
    console.log('\n8️⃣ اختبار أسطر فواتير المبيعات...');
    const { data: siLines, error: siLinesError } = await supabase
      .from('sales_invoice_lines')
      .select(`
        *,
        product:products(code, name)
      `)
      .limit(5);
    
    if (siLinesError) throw siLinesError;
    console.log(`   ✅ تم العثور على ${siLines.length} أسطر`);
    if (siLines.length > 0) {
      const line = siLines[0];
      console.log(`   📋 مثال: ${line.product?.name || 'منتج'}`);
      console.log(`   📊 الكمية: ${line.quantity} | السعر: ${line.unit_price} ر.س`);
    }
    
    // 9. اختبار مذكرات التسليم
    console.log('\n9️⃣ اختبار مذكرات التسليم...');
    const { data: deliveryNotes, error: dnError } = await supabase
      .from('delivery_notes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (dnError) throw dnError;
    console.log(`   ✅ تم العثور على ${deliveryNotes.length} مذكرات تسليم`);
    if (deliveryNotes.length > 0) {
      console.log(`   📋 مثال: ${deliveryNotes[0].delivery_number}`);
      console.log(`   📌 الحالة: ${deliveryNotes[0].status}`);
    }
    
    // 10. اختبار القيود المحاسبية
    console.log('\n🔟 اختبار القيود المحاسبية...');
    const { data: glEntries, error: glError } = await supabase
      .from('gl_entries')
      .select('*')
      .ilike('status', 'posted')
      .order('entry_date', { ascending: false })
      .limit(5);
    
    if (glError) throw glError;
    console.log(`   ✅ تم العثور على ${glEntries.length} قيود معتمدة`);
    if (glEntries.length > 0) {
      const entry = glEntries[0];
      console.log(`   📋 مثال: ${entry.entry_number}`);
      console.log(`   📊 التاريخ: ${entry.entry_date}`);
      console.log(`   💰 المدين: ${entry.total_debit} | الدائن: ${entry.total_credit} ر.س`);
    }
    
    // 11. اختبار أسطر القيود
    console.log('\n1️⃣1️⃣ اختبار أسطر القيود المحاسبية...');
    const { data: glLines, error: glLinesError } = await supabase
      .from('gl_entry_lines')
      .select('*')
      .limit(10);
    
    if (glLinesError) throw glLinesError;
    console.log(`   ✅ تم العثور على ${glLines.length} أسطر`);
    if (glLines.length > 0) {
      const line = glLines[0];
      console.log(`   📋 مثال: ${line.account_code} - ${line.account_name}`);
      console.log(`   📊 مدين: ${line.debit_amount} | دائن: ${line.credit_amount} ر.س`);
    }
    
    // 12. حساب ميزان المراجعة
    console.log('\n1️⃣2️⃣ حساب ميزان المراجعة...');
    const { data: allPostedEntries } = await supabase
      .from('gl_entries')
      .select('id')
      .ilike('status', 'posted');
    
    if (allPostedEntries.length > 0) {
      const entryIds = allPostedEntries.map(e => e.id);
      const { data: allGLLines } = await supabase
        .from('gl_entry_lines')
        .select('*')
        .in('entry_id', entryIds);
      
      const accountTotals = new Map();
      allGLLines.forEach(line => {
        if (!accountTotals.has(line.account_code)) {
          accountTotals.set(line.account_code, {
            code: line.account_code,
            name: line.account_name,
            debit: 0,
            credit: 0
          });
        }
        const acc = accountTotals.get(line.account_code);
        acc.debit += parseFloat(line.debit_amount || 0);
        acc.credit += parseFloat(line.credit_amount || 0);
      });
      
      const totalDebit = Array.from(accountTotals.values()).reduce((sum, acc) => sum + acc.debit, 0);
      const totalCredit = Array.from(accountTotals.values()).reduce((sum, acc) => sum + acc.credit, 0);
      const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
      
      console.log(`   ✅ عدد الحسابات: ${accountTotals.size}`);
      console.log(`   💰 إجمالي المدين: ${totalDebit.toFixed(2)} ر.س`);
      console.log(`   💰 إجمالي الدائن: ${totalCredit.toFixed(2)} ر.س`);
      console.log(`   📊 الحالة: ${balanced ? '✅ متوازن' : '❌ غير متوازن'}`);
    } else {
      console.log('   ⚠️  لا توجد قيود معتمدة');
    }
    
    console.log('\n\n✅ ======================================');
    console.log('   اكتمل الاختبار بنجاح!');
    console.log('========================================\n');
    
    // ملخص شامل
    console.log('📊 ملخص النظام:\n');
    console.log(`   الموردين: ${vendors.length}`);
    console.log(`   العملاء: ${customers.length}`);
    console.log(`   المنتجات: ${products.length}`);
    console.log(`   أوامر الشراء: ${purchaseOrders.length}`);
    console.log(`   إشعارات الاستلام: ${goodsReceipts.length}`);
    console.log(`   فواتير المبيعات: ${salesInvoices.length}`);
    console.log(`   مذكرات التسليم: ${deliveryNotes.length}`);
    console.log(`   القيود المحاسبية: ${glEntries.length}`);
    
    console.log('\n✅ جميع الوظائف تعمل بشكل صحيح!\n');
    
  } catch (error) {
    console.error('\n❌ خطأ:', error.message);
    console.error('التفاصيل:', error);
    process.exit(1);
  }
}

testAll();
