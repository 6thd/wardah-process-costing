// اختبار شامل لجميع وظائف المشتريات والمبيعات
const { createClient } = require('@supabase/supabase-js');
const config = require('./config.json');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
const orgId = config.APP_SETTINGS.orgId;

console.log('\n🧪 ======================================');
console.log('   اختبار شامل للمشتريات والمبيعات');
console.log('========================================\n');

// بيانات اختبار (مع timestamp لتجنب التكرار)
const timestamp = Date.now().toString().slice(-6);
const testData = {
  vendor: {
    code: `V${timestamp}`,
    name: `مورد الاختبار ${timestamp}`,
    contact_person: 'أحمد محمد',
    phone: '0501234567',
    email: `vendor${timestamp}@test.com`
  },
  customer: {
    code: `C${timestamp}`,
    name: `عميل الاختبار ${timestamp}`,
    contact_person: 'خالد علي',
    phone: '0559876543',
    email: `customer${timestamp}@test.com`
  },
  product: {
    code: `PP${timestamp}`,
    name: `منتج اختبار ${timestamp}`,
    type: 'product',
    cost_price: 25.00,
    sale_price: 40.00,
    uom: 'وحدة'
  }
};

async function runTests() {
  let vendorId, customerId, productId;
  
  try {
    console.log('📋 المرحلة 1: إعداد البيانات الأساسية\n');
    
    // 1. إنشاء مورد جديد
    console.log('1️⃣ إنشاء مورد جديد...');
    const { data: vendor, error: vendorError } = await supabase
      .from('vendors')
      .insert({
        org_id: orgId,
        ...testData.vendor
      })
      .select()
      .single();
    
    if (vendorError) throw vendorError;
    vendorId = vendor.id;
    console.log('   ✅ تم إنشاء المورد:', vendor.code, '-', vendor.name);
    
    // 2. إنشاء عميل جديد
    console.log('\n2️⃣ إنشاء عميل جديد...');
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert({
        org_id: orgId,
        ...testData.customer
      })
      .select()
      .single();
    
    if (customerError) throw customerError;
    customerId = customer.id;
    console.log('   ✅ تم إنشاء العميل:', customer.code, '-', customer.name);
    
    // 3. إنشاء منتج جديد
    console.log('\n3️⃣ إنشاء منتج جديد...');
    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({
        code: testData.product.code,
        name: testData.product.name,
        name_ar: testData.product.name,
        unit: testData.product.uom,
        cost_price: testData.product.cost_price,
        selling_price: testData.product.sale_price,
        price: testData.product.sale_price,
        stock_quantity: 0,
        minimum_stock: 0
      })
      .select()
      .single();
    
    if (productError) throw productError;
    productId = product.id;
    console.log('   ✅ تم إنشاء المنتج:', product.code, '-', product.name);
    
    console.log('\n\n🛒 المرحلة 2: اختبار دورة المشتريات الكاملة\n');
    
    // 4. إنشاء أمر شراء
    console.log('4️⃣ إنشاء أمر شراء...');
    const poNumber = `PO-TEST-${Date.now()}`;
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        org_id: orgId,
        order_number: poNumber,
        vendor_id: vendorId,
        order_date: new Date().toISOString().split('T')[0],
        status: 'draft',
        subtotal: 0,
        tax_amount: 0,
        total_amount: 0
      })
      .select()
      .single();
    
    if (poError) throw poError;
    console.log('   ✅ تم إنشاء أمر الشراء:', po.order_number);
    
    // 5. إضافة سطر للأمر
    console.log('\n5️⃣ إضافة سطر لأمر الشراء...');
    const { data: poLine, error: poLineError } = await supabase
      .from('purchase_order_lines')
      .insert({
        org_id: orgId,
        po_id: po.id,
        product_id: productId,
        quantity: 1000,
        unit_price: 25.00,
        line_total: 25000.00
      })
      .select()
      .single();
    
    if (poLineError) throw poLineError;
    console.log('   ✅ تم إضافة السطر: الكمية 1000، السعر 25.00، الإجمالي 25,000.00 ر.س');
    
    // 6. تحديث إجمالي الأمر
    console.log('\n6️⃣ تحديث إجمالي أمر الشراء...');
    const { error: poUpdateError } = await supabase
      .from('purchase_orders')
      .update({ total_amount: 25000.00 })
      .eq('id', po.id);
    
    if (poUpdateError) throw poUpdateError;
    console.log('   ✅ تم تحديث الإجمالي: 25,000.00 ر.س');
    
    // 7. اعتماد أمر الشراء
    console.log('\n7️⃣ اعتماد أمر الشراء...');
    const { error: poConfirmError } = await supabase
      .from('purchase_orders')
      .update({ status: 'confirmed' })
      .eq('id', po.id);
    
    if (poConfirmError) throw poConfirmError;
    console.log('   ✅ تم اعتماد الأمر');
    
    // 8. استلام البضاعة (Goods Receipt)
    console.log('\n8️⃣ استلام البضاعة...');
    const grNumber = `GR-TEST-${Date.now()}`;
    const { data: gr, error: grError } = await supabase
      .from('goods_receipts')
      .insert({
        org_id: orgId,
        gr_number: grNumber,
        po_id: po.id,
        receipt_date: new Date().toISOString().split('T')[0],
        status: 'draft'
      })
      .select()
      .single();
    
    if (grError) throw grError;
    console.log('   ✅ تم إنشاء إشعار الاستلام:', gr.gr_number);
    
    // 9. إضافة سطر الاستلام
    console.log('\n9️⃣ إضافة سطر الاستلام...');
    const { data: grLine, error: grLineError } = await supabase
      .from('goods_receipt_lines')
      .insert({
        org_id: orgId,
        gr_id: gr.id,
        po_line_id: poLine.id,
        product_id: productId,
        quantity_received: 1000,
        unit_cost: 25.00
      })
      .select()
      .single();
    
    if (grLineError) throw grLineError;
    console.log('   ✅ تم إضافة سطر الاستلام: 1000 وحدة');
    
    // 10. ترحيل الاستلام (تحديث المخزون)
    console.log('\n🔟 ترحيل الاستلام وتحديث المخزون...');
    const { error: grPostError } = await supabase.rpc('process_goods_receipt', {
      p_gr_id: gr.id,
      p_org_id: orgId
    });
    
    if (grPostError) {
      console.log('   ⚠️  RPC غير موجود، سنحدث المخزون يدوياً...');
      
      // تحديث المخزون يدوياً
      const { data: currentProduct } = await supabase
        .from('products')
        .select('stock_quantity, cost_price')
        .eq('id', productId)
        .single();
      
      const oldQty = currentProduct.stock_quantity || 0;
      const oldCost = currentProduct.cost_price || 0;
      const newQty = oldQty + 1000;
      const totalValue = (oldQty * oldCost) + (1000 * 25.00);
      const newAvgCost = totalValue / newQty;
      
      const { error: stockUpdateError } = await supabase
        .from('products')
        .update({
          stock_quantity: newQty,
          cost_price: newAvgCost
        })
        .eq('id', productId);
      
      if (stockUpdateError) throw stockUpdateError;
      
      console.log('   ✅ تم تحديث المخزون:');
      console.log('      الكمية السابقة:', oldQty);
      console.log('      الكمية الجديدة:', newQty);
      console.log('      التكلفة المتوسطة:', newAvgCost.toFixed(2), 'ر.س');
    } else {
      console.log('   ✅ تم ترحيل الاستلام بنجاح');
    }
    
    // 11. إنشاء قيد محاسبي للشراء
    console.log('\n1️⃣1️⃣ إنشاء قيد محاسبي للشراء...');
    const jeNumber = `JE-PO-${Date.now()}`;
    const { data: je, error: jeError } = await supabase
      .from('gl_entries')
      .insert({
        org_id: orgId,
        entry_number: jeNumber,
        entry_date: new Date().toISOString().split('T')[0],
        description: `شراء بضاعة - ${po.po_number}`,
        reference_type: 'purchase_order',
        reference_id: po.id,
        status: 'posted',
        total_debit: 25000.00,
        total_credit: 25000.00
      })
      .select()
      .single();
    
    if (jeError) throw jeError;
    console.log('   ✅ تم إنشاء القيد:', je.entry_number);
    
    // 12. إضافة أسطر القيد
    console.log('\n1️⃣2️⃣ إضافة أسطر القيد...');
    const { error: jeLinesError } = await supabase
      .from('gl_entry_lines')
      .insert([
        {
          org_id: orgId,
          entry_id: je.id,
          account_code: '1120',
          account_name: 'المخزون - المواد الخام',
          debit_amount: 25000.00,
          credit_amount: 0,
          description: 'استلام بضاعة'
        },
        {
          org_id: orgId,
          entry_id: je.id,
          account_code: '2110',
          account_name: 'الموردون - الحسابات الدائنة',
          debit_amount: 0,
          credit_amount: 25000.00,
          description: 'مستحق للمورد'
        }
      ]);
    
    if (jeLinesError) throw jeLinesError;
    console.log('   ✅ تم إضافة أسطر القيد (مدين: 1120، دائن: 2110)');
    
    // التحقق من المخزون بعد الشراء
    console.log('\n📊 التحقق من المخزون بعد الشراء...');
    const { data: productAfterPurchase } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();
    
    console.log('   المخزون الحالي:', productAfterPurchase.stock_quantity, 'وحدة');
    console.log('   التكلفة المتوسطة:', productAfterPurchase.cost_price, 'ر.س');
    console.log('   قيمة المخزون:', (productAfterPurchase.stock_quantity * productAfterPurchase.cost_price).toFixed(2), 'ر.س');
    
    console.log('\n\n💰 المرحلة 3: اختبار دورة المبيعات الكاملة\n');
    
    // 13. إنشاء فاتورة مبيعات
    console.log('1️⃣3️⃣ إنشاء فاتورة مبيعات...');
    const siNumber = `SI-TEST-${Date.now()}`;
    const { data: si, error: siError } = await supabase
      .from('sales_invoices')
      .insert({
        org_id: orgId,
        invoice_number: siNumber,
        customer_id: customerId,
        invoice_date: new Date().toISOString().split('T')[0],
        status: 'draft',
        subtotal: 0,
        tax_amount: 0,
        total_amount: 0
      })
      .select()
      .single();
    
    if (siError) throw siError;
    console.log('   ✅ تم إنشاء الفاتورة:', si.invoice_number);
    
    // 14. إضافة سطر للفاتورة
    console.log('\n1️⃣4️⃣ إضافة سطر للفاتورة...');
    const sellQty = 400;
    const sellPrice = 40.00;
    const lineTotal = sellQty * sellPrice;
    
    const { data: siLine, error: siLineError } = await supabase
      .from('sales_invoice_lines')
      .insert({
        org_id: orgId,
        invoice_id: si.id,
        product_id: productId,
        quantity: sellQty,
        unit_price: sellPrice,
        line_total: lineTotal,
        tax_rate: 0.15
      })
      .select()
      .single();
    
    if (siLineError) throw siLineError;
    console.log('   ✅ تم إضافة السطر: الكمية', sellQty, '، السعر', sellPrice, '، الإجمالي', lineTotal.toFixed(2), 'ر.س');
    
    // 15. تحديث إجمالي الفاتورة
    console.log('\n1️⃣5️⃣ تحديث إجمالي الفاتورة...');
    const taxAmount = lineTotal * 0.15;
    const totalWithTax = lineTotal + taxAmount;
    
    const { error: siUpdateError } = await supabase
      .from('sales_invoices')
      .update({
        subtotal: lineTotal,
        tax_amount: taxAmount,
        total_amount: totalWithTax
      })
      .eq('id', si.id);
    
    if (siUpdateError) throw siUpdateError;
    console.log('   ✅ الإجمالي قبل الضريبة:', lineTotal.toFixed(2), 'ر.س');
    console.log('   ✅ ضريبة القيمة المضافة (15%):', taxAmount.toFixed(2), 'ر.س');
    console.log('   ✅ الإجمالي النهائي:', totalWithTax.toFixed(2), 'ر.س');
    
    // 16. حساب COGS (تكلفة البضاعة المباعة)
    console.log('\n1️⃣6️⃣ حساب تكلفة البضاعة المباعة (COGS)...');
    const currentCost = productAfterPurchase.cost_price;
    const cogs = sellQty * currentCost;
    
    console.log('   التكلفة الحالية للوحدة:', currentCost.toFixed(2), 'ر.س');
    console.log('   الكمية المباعة:', sellQty);
    console.log('   ✅ COGS:', cogs.toFixed(2), 'ر.س');
    
    // 17. حساب الربح
    console.log('\n1️⃣7️⃣ حساب الربح...');
    const profit = lineTotal - cogs;
    const profitMargin = (profit / lineTotal) * 100;
    
    console.log('   الإيراد:', lineTotal.toFixed(2), 'ر.س');
    console.log('   التكلفة:', cogs.toFixed(2), 'ر.س');
    console.log('   ✅ الربح:', profit.toFixed(2), 'ر.س');
    console.log('   ✅ هامش الربح:', profitMargin.toFixed(2), '%');
    
    // 18. تحديث المخزون بعد البيع
    console.log('\n1️⃣8️⃣ تحديث المخزون بعد البيع...');
    const newStock = productAfterPurchase.stock_quantity - sellQty;
    
    const { error: stockDeductError } = await supabase
      .from('products')
      .update({ stock_quantity: newStock })
      .eq('id', productId);
    
    if (stockDeductError) throw stockDeductError;
    console.log('   ✅ المخزون السابق:', productAfterPurchase.stock_quantity);
    console.log('   ✅ المخزون الجديد:', newStock);
    
    // 19. إنشاء قيد محاسبي للبيع
    console.log('\n1️⃣9️⃣ إنشاء قيد محاسبي للبيع...');
    const jeSaleNumber = `JE-SI-${Date.now()}`;
    const { data: jeSale, error: jeSaleError } = await supabase
      .from('gl_entries')
      .insert({
        org_id: orgId,
        entry_number: jeSaleNumber,
        entry_date: new Date().toISOString().split('T')[0],
        description: `مبيعات - ${si.invoice_number}`,
        reference_type: 'sales_invoice',
        reference_id: si.id,
        status: 'posted',
        total_debit: totalWithTax + cogs,
        total_credit: totalWithTax + cogs
      })
      .select()
      .single();
    
    if (jeSaleError) throw jeSaleError;
    console.log('   ✅ تم إنشاء القيد:', jeSale.entry_number);
    
    // 20. إضافة أسطر قيد البيع
    console.log('\n2️⃣0️⃣ إضافة أسطر قيد البيع...');
    const { error: jeSaleLinesError } = await supabase
      .from('gl_entry_lines')
      .insert([
        {
          org_id: orgId,
          entry_id: jeSale.id,
          account_code: '1130',
          account_name: 'العملاء - الحسابات المدينة',
          debit_amount: totalWithTax,
          credit_amount: 0,
          description: 'مستحق من العميل'
        },
        {
          org_id: orgId,
          entry_id: jeSale.id,
          account_code: '4101',
          account_name: 'إيرادات المبيعات',
          debit_amount: 0,
          credit_amount: lineTotal,
          description: 'إيراد المبيعات'
        },
        {
          org_id: orgId,
          entry_id: jeSale.id,
          account_code: '2310',
          account_name: 'ضريبة القيمة المضافة المستحقة',
          debit_amount: 0,
          credit_amount: taxAmount,
          description: 'ضريبة 15%'
        },
        {
          org_id: orgId,
          entry_id: jeSale.id,
          account_code: '5101',
          account_name: 'تكلفة البضاعة المباعة',
          debit_amount: cogs,
          credit_amount: 0,
          description: 'COGS'
        },
        {
          org_id: orgId,
          entry_id: jeSale.id,
          account_code: '1120',
          account_name: 'المخزون - المواد الخام',
          debit_amount: 0,
          credit_amount: cogs,
          description: 'إخراج من المخزون'
        }
      ]);
    
    if (jeSaleLinesError) throw jeSaleLinesError;
    console.log('   ✅ تم إضافة 5 أسطر للقيد');
    
    console.log('\n\n📈 المرحلة 4: التقارير النهائية\n');
    
    // 21. عرض حالة المنتج النهائية
    console.log('2️⃣1️⃣ حالة المنتج النهائية...');
    const { data: finalProduct } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();
    
    console.log('   المنتج:', finalProduct.name);
    console.log('   المخزون:', finalProduct.stock_quantity, 'وحدة');
    console.log('   التكلفة المتوسطة:', finalProduct.cost_price.toFixed(2), 'ر.س');
    console.log('   قيمة المخزون:', (finalProduct.stock_quantity * finalProduct.cost_price).toFixed(2), 'ر.س');
    
    // 22. حساب ميزان المراجعة
    console.log('\n2️⃣2️⃣ حساب ميزان المراجعة...');
    
    const { data: allEntries } = await supabase
      .from('gl_entries')
      .select('id')
      .ilike('status', 'posted');
    
    const entryIds = allEntries.map(e => e.id);
    
    const { data: allLines } = await supabase
      .from('gl_entry_lines')
      .select('*')
      .in('entry_id', entryIds);
    
    const accountTotals = new Map();
    
    allLines.forEach(line => {
      if (!accountTotals.has(line.account_code)) {
        accountTotals.set(line.account_code, {
          account_code: line.account_code,
          account_name: line.account_name,
          debit: 0,
          credit: 0
        });
      }
      
      const account = accountTotals.get(line.account_code);
      account.debit += parseFloat(line.debit_amount || 0);
      account.credit += parseFloat(line.credit_amount || 0);
    });
    
    const trialBalance = Array.from(accountTotals.values())
      .sort((a, b) => a.account_code.localeCompare(b.account_code));
    
    const totalDebit = trialBalance.reduce((sum, acc) => sum + acc.debit, 0);
    const totalCredit = trialBalance.reduce((sum, acc) => sum + acc.credit, 0);
    
    console.log('\n   📊 ميزان المراجعة:');
    console.log('   ' + '='.repeat(80));
    console.log('   رمز      الحساب                                    مدين            دائن');
    console.log('   ' + '-'.repeat(80));
    
    trialBalance.forEach(acc => {
      const code = acc.account_code.padEnd(8);
      const name = acc.account_name.padEnd(35);
      const debit = acc.debit.toFixed(2).padStart(12);
      const credit = acc.credit.toFixed(2).padStart(12);
      console.log(`   ${code} ${name} ${debit}    ${credit}`);
    });
    
    console.log('   ' + '-'.repeat(80));
    console.log(`   ${'الإجمالي'.padEnd(43)} ${totalDebit.toFixed(2).padStart(12)}    ${totalCredit.toFixed(2).padStart(12)}`);
    console.log('   ' + '='.repeat(80));
    
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
    console.log('\n   الحالة:', balanced ? '✅ متوازن' : '❌ غير متوازن');
    console.log('   الفرق:', (totalDebit - totalCredit).toFixed(2), 'ر.س');
    
    console.log('\n\n✅ ======================================');
    console.log('   اكتمل الاختبار بنجاح!');
    console.log('========================================\n');
    
    // ملخص النتائج
    console.log('📊 ملخص النتائج:\n');
    console.log('   المشتريات:');
    console.log('   • أمر شراء:', po.po_number);
    console.log('   • إشعار استلام:', gr.gr_number);
    console.log('   • الكمية المستلمة: 1000 وحدة');
    console.log('   • التكلفة الإجمالية: 25,000.00 ر.س');
    
    console.log('\n   المبيعات:');
    console.log('   • فاتورة مبيعات:', si.invoice_number);
    console.log('   • الكمية المباعة:', sellQty, 'وحدة');
    console.log('   • الإيراد:', lineTotal.toFixed(2), 'ر.س');
    console.log('   • الربح:', profit.toFixed(2), 'ر.س (', profitMargin.toFixed(2), '%)');
    
    console.log('\n   المخزون:');
    console.log('   • الرصيد النهائي:', finalProduct.stock_quantity, 'وحدة');
    console.log('   • التكلفة المتوسطة:', finalProduct.cost_price.toFixed(2), 'ر.س');
    console.log('   • قيمة المخزون:', (finalProduct.stock_quantity * finalProduct.cost_price).toFixed(2), 'ر.س');
    
    console.log('\n   المحاسبة:');
    console.log('   • عدد القيود:', allEntries.length);
    console.log('   • عدد الحسابات:', trialBalance.length);
    console.log('   • الميزان:', balanced ? 'متوازن ✅' : 'غير متوازن ❌');
    
  } catch (error) {
    console.error('\n❌ حدث خطأ:', error.message);
    console.error('التفاصيل:', error);
    process.exit(1);
  }
}

runTests();
