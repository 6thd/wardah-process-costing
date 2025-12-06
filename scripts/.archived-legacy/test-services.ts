/**
 * اختبار سريع للخدمات المطورة
 * Quick Test for Developed Services
 */

import { 
  createPurchaseOrder, 
  receiveGoods, 
  createSupplierInvoice 
} from './src/services/purchasing-service';

import { 
  createSalesInvoice, 
  deliverGoods, 
  recordCustomerCollection,
  calculateInvoiceProfit 
} from './src/services/sales-service';

import { 
  getTrialBalance, 
  getIncomeStatement, 
  getBalanceSheet 
} from './src/services/accounting-service';

// ==========================================
// اختبار دورة المشتريات
// ==========================================

async function testPurchasingCycle() {
  console.log('🔄 اختبار دورة المشتريات...\n');

  // 1. إنشاء أمر شراء
  console.log('1️⃣ إنشاء أمر شراء...');
  const poResult = await createPurchaseOrder({
    vendor_id: 'test-vendor-id',
    order_date: '2025-11-05',
    expected_delivery_date: '2025-11-10',
    status: 'approved',
    notes: 'أمر شراء اختباري',
    lines: [
      {
        product_id: 'product-001',
        quantity: 1000,
        unit_price: 5.20,
        discount_percentage: 0,
        tax_percentage: 15,
      },
    ],
  });

  if (!poResult.success) {
    console.error('❌ فشل إنشاء أمر الشراء:', poResult.error);
    return;
  }
  console.log('✅ تم إنشاء أمر الشراء:', poResult.data.id);

  // 2. استلام البضائع (تحديث AVCO)
  console.log('\n2️⃣ استلام البضائع مع تحديث AVCO...');
  const grResult = await receiveGoods(
    {
      purchase_order_id: poResult.data.id,
      vendor_id: 'test-vendor-id',
      warehouse_id: 'test-warehouse-id',
      receipt_date: '2025-11-06',
      warehouse_location: 'المستودع الرئيسي',
      receiver_name: 'أحمد محمد',
    },
    [
      {
        product_id: 'product-001',
        ordered_quantity: 1000,
        received_quantity: 1000,
        unit_cost: 5.20,
        quality_status: 'accepted',
      },
    ]
  );

  if (!grResult.success) {
    console.error('❌ فشل استلام البضائع:', grResult.error);
    return;
  }
  console.log('✅ تم استلام البضائع وتحديث AVCO');
  console.log('   المخزون الجديد: تحقق من products.cost_price');

  // 3. إنشاء فاتورة مورد (مع قيد محاسبي)
  console.log('\n3️⃣ إنشاء فاتورة مورد مع قيد محاسبي...');
  const invResult = await createSupplierInvoice({
    invoice_number: 'INV-001',
    vendor_id: 'test-vendor-id',
    purchase_order_id: poResult.data.id,
    goods_receipt_id: grResult.data.id,
    invoice_date: '2025-11-06',
    due_date: '2025-12-06',
    payment_terms: 'نت 30',
    subtotal: 5200,
    discount_amount: 0,
    tax_amount: 780,
    total_amount: 5980,
    status: 'approved',
    lines: [
      {
        product_id: 'product-001',
        quantity: 1000,
        unit_cost: 5.20,
        tax_percentage: 15,
      },
    ],
  });

  if (!invResult.success) {
    console.error('❌ فشل إنشاء فاتورة المورد:', invResult.error);
    return;
  }
  console.log('✅ تم إنشاء فاتورة المورد والقيد المحاسبي');
  console.log('   القيد: Dr. المخزون 5,200 + Dr. ضريبة 780 / Cr. موردين 5,980');
}

// ==========================================
// اختبار دورة المبيعات
// ==========================================

async function testSalesCycle() {
  console.log('\n\n🔄 اختبار دورة المبيعات...\n');

  // 1. إنشاء فاتورة مبيعات
  console.log('1️⃣ إنشاء فاتورة مبيعات...');
  const invResult = await createSalesInvoice({
    invoice_number: 'SINV-001',
    customer_id: 'test-customer-id',
    invoice_date: '2025-11-07',
    due_date: '2025-11-17',
    payment_terms: 'نت 10',
    delivery_status: 'pending',
    payment_status: 'unpaid',
    subtotal: 2100,
    discount_amount: 0,
    tax_amount: 315,
    total_amount: 2415,
    lines: [
      {
        product_id: 'product-001',
        quantity: 300,
        unit_price: 7.00,
        tax_percentage: 15,
      },
    ],
  });

  if (!invResult.success) {
    console.error('❌ فشل إنشاء فاتورة المبيعات:', invResult.error);
    return;
  }
  console.log('✅ تم إنشاء فاتورة المبيعات والقيد المحاسبي');
  console.log('   القيد: Dr. عملاء 2,415 / Cr. مبيعات 2,100 + Cr. ضريبة 315');

  // 2. تسليم البضائع (خصم AVCO + COGS)
  console.log('\n2️⃣ تسليم البضائع مع حساب COGS...');
  const dnResult = await deliverGoods(
    {
      sales_invoice_id: invResult.data.id,
      customer_id: 'test-customer-id',
      delivery_date: '2025-11-07',
      vehicle_number: 'ABC-1234',
      driver_name: 'خالد أحمد',
    },
    [
      {
        product_id: 'product-001',
        invoiced_quantity: 300,
        delivered_quantity: 300,
        unit_price: 7.00,
      },
    ]
  );

  if (!dnResult.success) {
    console.error('❌ فشل تسليم البضائع:', dnResult.error);
    return;
  }
  console.log('✅ تم تسليم البضائع وخصم المخزون');
  console.log(`   COGS المحتسب: ${dnResult.totalCOGS} ريال`);
  console.log(`   القيد: Dr. COGS ${dnResult.totalCOGS} / Cr. مخزون ${dnResult.totalCOGS}`);

  // 3. حساب الربح
  console.log('\n3️⃣ حساب الربح من الفاتورة...');
  const profitResult = await calculateInvoiceProfit(invResult.data.id);
  
  if (profitResult.success && profitResult.profitMargin !== undefined) {
    console.log('✅ تحليل الربحية:');
    console.log(`   الإيرادات: ${profitResult.revenue} ريال`);
    console.log(`   COGS: ${profitResult.cogs} ريال`);
    console.log(`   الربح: ${profitResult.profit} ريال`);
    console.log(`   نسبة الربح: ${profitResult.profitMargin.toFixed(2)}%`);
  }

  // 4. تسجيل تحصيل
  console.log('\n4️⃣ تسجيل تحصيل من العميل...');
  const collectionResult = await recordCustomerCollection(
    invResult.data.id,
    2415,
    '2025-11-08',
    'cash'
  );

  if (collectionResult.success) {
    console.log('✅ تم تسجيل التحصيل');
    console.log(`   الرصيد المتبقي: ${collectionResult.balance} ريال`);
    console.log(`   الحالة: ${collectionResult.newStatus}`);
    console.log('   القيد: Dr. نقدية 2,415 / Cr. عملاء 2,415');
  }
}

// ==========================================
// اختبار التقارير المحاسبية
// ==========================================

async function testAccountingReports() {
  console.log('\n\n📊 اختبار التقارير المحاسبية...\n');

  // 1. ميزان المراجعة
  console.log('1️⃣ ميزان المراجعة...');
  const trialBalance = await getTrialBalance('2025-11-01', '2025-11-30');
  
  if (trialBalance.success && trialBalance.totals && trialBalance.balances) {
    console.log('✅ ميزان المراجعة:');
    console.log(`   مجموع المدين: ${trialBalance.totals.totalDebit} ريال`);
    console.log(`   مجموع الدائن: ${trialBalance.totals.totalCredit} ريال`);
    console.log(`   متوازن: ${trialBalance.isBalanced ? 'نعم ✅' : 'لا ❌'}`);
    console.log(`   عدد الحسابات: ${trialBalance.balances.length}`);
  }

  // 2. قائمة الدخل
  console.log('\n2️⃣ قائمة الدخل...');
  const incomeStatement = await getIncomeStatement('2025-11-01', '2025-11-30');
  
  if (incomeStatement.success && incomeStatement.profitMargin !== undefined) {
    console.log('✅ قائمة الدخل:');
    console.log(`   إجمالي الإيرادات: ${incomeStatement.totalRevenue} ريال`);
    console.log(`   إجمالي المصروفات: ${incomeStatement.totalExpense} ريال`);
    console.log(`   صافي الدخل: ${incomeStatement.netIncome} ريال`);
    console.log(`   نسبة الربح: ${incomeStatement.profitMargin.toFixed(2)}%`);
  }

  // 3. الميزانية العمومية
  console.log('\n3️⃣ الميزانية العمومية...');
  const balanceSheet = await getBalanceSheet('2025-11-30');
  
  if (balanceSheet.success) {
    console.log('✅ الميزانية العمومية:');
    console.log(`   إجمالي الأصول: ${balanceSheet.totalAssets} ريال`);
    console.log(`   إجمالي الخصوم: ${balanceSheet.totalLiabilities} ريال`);
    console.log(`   إجمالي حقوق الملكية: ${balanceSheet.totalEquity} ريال`);
    console.log(`   متوازنة: ${balanceSheet.isBalanced ? 'نعم ✅' : 'لا ❌'}`);
  }
}

// ==========================================
// تشغيل جميع الاختبارات
// ==========================================

export async function runAllTests() {
  console.log('═══════════════════════════════════════════════');
  console.log('   اختبار خدمات المشتريات والمبيعات والمحاسبة');
  console.log('═══════════════════════════════════════════════\n');

  try {
    await testPurchasingCycle();
    await testSalesCycle();
    await testAccountingReports();

    console.log('\n═══════════════════════════════════════════════');
    console.log('✅ اكتملت جميع الاختبارات بنجاح!');
    console.log('═══════════════════════════════════════════════\n');
  } catch (error) {
    console.error('\n❌ خطأ في الاختبار:', error);
  }
}

// ملاحظة: هذا ملف اختبار نظري
// يجب تشغيله بعد:
// 1. تنفيذ create-procurement-sales-tables.sql في Supabase
// 2. إعداد بيانات اختبارية (موردين، عملاء، منتجات)
// 3. التأكد من تفعيل جدول gl_entries

console.log(`
📝 ملاحظات مهمة قبل التشغيل:

1. ✅ تأكد من تنفيذ create-procurement-sales-tables.sql في Supabase
2. ✅ أنشئ بيانات اختبارية:
   - مورد (vendor)
   - عميل (customer)
   - منتج (product) بكمية مبدئية ومتوسط تكلفة
   - مستودع (warehouse)
3. ✅ استبدل المعرفات التجريبية بمعرفات حقيقية:
   - test-vendor-id
   - test-customer-id
   - test-warehouse-id
   - product-001
4. ✅ تأكد من وجود جدول gl_entries
5. ✅ تأكد من وجود الحسابات في gl_accounts:
   - 1110 (نقدية)
   - 1120 (عملاء)
   - 1130 (مخزون)
   - 1161 (ضريبة مدخلات)
   - 2101 (موردين)
   - 2162 (ضريبة مخرجات)
   - 4001 (مبيعات)
   - 5001 (COGS)

بعد تنفيذ هذه الخطوات، قم باستدعاء:
await runAllTests();
`);
