# 🚀 الخطوات التالية - Next Steps

تم بحمد الله تطوير خدمات المشتريات والمبيعات والمحاسبة بنجاح!

---

## ✅ تم إنجازه

- ✅ **خدمة المشتريات** (purchasing-service.ts) - 700 سطر
- ✅ **خدمة المبيعات** (sales-service.ts) - 600 سطر  
- ✅ **خدمة المحاسبة** (accounting-service.ts) - 600 سطر
- ✅ **التكامل الكامل مع AVCO**
- ✅ **القيود المحاسبية التلقائية**
- ✅ **5 تقارير محاسبية جاهزة**
- ✅ **توثيق شامل** (5 ملفات)
- ✅ **SQL للجداول الجديدة** (create-procurement-sales-tables.sql)

**المجموع**: 1,900+ سطر كود + 4,500+ سطر توثيق

---

## 📋 الخطوة 1: تنفيذ SQL في Supabase

### يجب تنفيذه الآن:

1. افتح **Supabase Dashboard**
2. اذهب إلى **SQL Editor**
3. انسخ محتوى الملف: `create-procurement-sales-tables.sql`
4. شغّل الكود
5. تحقق من إنشاء الجداول التالية:

#### الجداول الجديدة (9):
- ✅ `purchase_order_lines` - سطور أوامر الشراء
- ✅ `goods_receipts` - سندات استلام البضائع
- ✅ `goods_receipt_lines` - سطور سندات الاستلام
- ✅ `supplier_invoices` - فواتير الموردين
- ✅ `supplier_invoice_lines` - سطور فواتير الموردين
- ✅ `sales_invoices` - فواتير المبيعات
- ✅ `sales_invoice_lines` - سطور فواتير المبيعات
- ✅ `delivery_notes` - أذون التسليم
- ✅ `delivery_note_lines` - سطور أذون التسليم

### ملاحظات مهمة:
- ⚠️ تأكد من وجود جدول `gl_entries` (للقيود المحاسبية)
- ⚠️ تأكد من وجود الحسابات في `gl_accounts`:
  - 1110 (نقدية)
  - 1120 (عملاء)
  - 1130 (مخزون)
  - 1161 (ضريبة مدخلات)
  - 2101 (موردين)
  - 2162 (ضريبة مخرجات)
  - 4001 (مبيعات)
  - 5001 (COGS)

---

## 📋 الخطوة 2: تطوير واجهات المستخدم

### الواجهات المطلوبة:

#### 1. واجهة أوامر الشراء
**الملف**: `src/features/purchasing/PurchaseOrderForm.tsx`

**المكونات**:
- نموذج إدخال أمر شراء
- اختيار المورد (dropdown)
- جدول لإضافة المنتجات (product picker + quantity + unit price)
- حساب الإجماليات تلقائياً (subtotal, discount, tax, total)
- أزرار: حفظ كمسودة، اعتماد، إلغاء

**الاستدعاء**:
```typescript
import { createPurchaseOrder } from '@/services/purchasing-service';

const handleSubmit = async (data) => {
  const result = await createPurchaseOrder({
    vendor_id: selectedVendor.id,
    order_date: orderDate,
    status: 'approved',
    lines: selectedProducts.map(p => ({
      product_id: p.id,
      quantity: p.quantity,
      unit_price: p.unitPrice,
      tax_percentage: 15
    }))
  });
  
  if (result.success) {
    toast.success('تم إنشاء أمر الشراء بنجاح');
  }
};
```

---

#### 2. واجهة استلام البضائع
**الملف**: `src/features/purchasing/GoodsReceiptForm.tsx`

**المكونات**:
- اختيار أمر شراء معتمد
- عرض تفاصيل أمر الشراء
- جدول لإدخال الكمية المستلمة لكل منتج
- اختيار حالة الجودة (مقبول/مرفوض/قيد الفحص)
- **عرض تحديث AVCO المباشر** لكل منتج
- أزرار: حفظ الاستلام

**الاستدعاء**:
```typescript
import { receiveGoods } from '@/services/purchasing-service';

const handleReceive = async () => {
  const result = await receiveGoods({
    purchase_order_id: selectedPO.id,
    vendor_id: selectedPO.vendor_id,
    receipt_date: new Date().toISOString()
  }, receivedLines.map(line => ({
    product_id: line.product_id,
    ordered_quantity: line.ordered_quantity,
    received_quantity: line.received_quantity,
    unit_cost: line.unit_cost,
    quality_status: 'accepted'
  })));
  
  if (result.success) {
    toast.success('تم استلام البضائع وتحديث AVCO');
    // عرض رسالة: "تم تحديث المتوسط المرجح للمنتج X من 5.00 إلى 5.13"
  }
};
```

---

#### 3. واجهة فواتير الموردين
**الملف**: `src/features/purchasing/SupplierInvoiceForm.tsx`

**المكونات**:
- اختيار مورد
- اختيار سند استلام (اختياري)
- إدخال رقم الفاتورة وتاريخ الاستحقاق
- جدول المنتجات والكميات
- حساب الإجماليات (مع الضريبة)
- **عرض القيد المحاسبي التلقائي**
- أزرار: حفظ كمسودة، اعتماد (ينشئ القيد)

**الاستدعاء**:
```typescript
import { createSupplierInvoice } from '@/services/purchasing-service';

const handleCreateInvoice = async () => {
  const result = await createSupplierInvoice({
    invoice_number: invoiceNumber,
    vendor_id: selectedVendor.id,
    goods_receipt_id: selectedGR?.id,
    invoice_date: invoiceDate,
    due_date: dueDate,
    subtotal: calculateSubtotal(),
    tax_amount: calculateTax(),
    total_amount: calculateTotal(),
    status: 'approved',  // ← ينشئ القيد فوراً
    lines: invoiceLines
  });
  
  if (result.success) {
    toast.success('تم إنشاء الفاتورة والقيد المحاسبي');
    // عرض القيد: Dr. مخزون + Dr. ضريبة / Cr. موردين
  }
};
```

---

#### 4. واجهة فواتير المبيعات
**الملف**: `src/features/sales/SalesInvoiceForm.tsx`

**المكونات**:
- اختيار العميل
- إدخال رقم الفاتورة وتاريخ الاستحقاق
- جدول لإضافة المنتجات (مع التحقق من توفر المخزون)
- عرض **الربح المتوقع** قبل الحفظ
- حساب الإجماليات
- **عرض القيد المحاسبي التلقائي**
- أزرار: حفظ وإصدار

**الاستدعاء**:
```typescript
import { createSalesInvoice } from '@/services/sales-service';

const handleCreateInvoice = async () => {
  // التحقق من المخزون أولاً
  for (const line of invoiceLines) {
    const product = await getProduct(line.product_id);
    if (product.quantity_in_stock < line.quantity) {
      toast.error(`المخزون غير كافٍ للمنتج ${product.name}`);
      return;
    }
  }
  
  const result = await createSalesInvoice({
    invoice_number: invoiceNumber,
    customer_id: selectedCustomer.id,
    invoice_date: invoiceDate,
    due_date: dueDate,
    delivery_status: 'pending',
    payment_status: 'unpaid',
    subtotal: calculateSubtotal(),
    tax_amount: calculateTax(),
    total_amount: calculateTotal(),
    lines: invoiceLines
  });
  
  if (result.success) {
    toast.success('تم إنشاء فاتورة المبيعات والقيد المحاسبي');
    // عرض القيد: Dr. عملاء / Cr. مبيعات + Cr. ضريبة
  }
};
```

---

#### 5. واجهة أذون التسليم
**الملف**: `src/features/sales/DeliveryNoteForm.tsx`

**المكونات**:
- اختيار فاتورة مبيعات معتمدة
- عرض تفاصيل الفاتورة
- جدول لإدخال الكمية المسلمة
- إدخال معلومات السائق والمركبة
- **عرض COGS المحتسب من AVCO لكل منتج**
- **عرض القيد المحاسبي التلقائي (COGS)**
- أزرار: تأكيد التسليم

**الاستدعاء**:
```typescript
import { deliverGoods, calculateInvoiceProfit } from '@/services/sales-service';

const handleDeliver = async () => {
  const result = await deliverGoods({
    sales_invoice_id: selectedInvoice.id,
    customer_id: selectedInvoice.customer_id,
    delivery_date: new Date().toISOString(),
    vehicle_number: vehicleNumber,
    driver_name: driverName
  }, deliveryLines.map(line => ({
    product_id: line.product_id,
    invoiced_quantity: line.invoiced_quantity,
    delivered_quantity: line.delivered_quantity,
    unit_price: line.unit_price
  })));
  
  if (result.success) {
    toast.success(`تم التسليم. COGS: ${result.totalCOGS} ريال`);
    
    // حساب الربح
    const profit = await calculateInvoiceProfit(selectedInvoice.id);
    toast.info(`الربح: ${profit.profit} ريال (${profit.profitMargin}%)`);
    
    // عرض القيد: Dr. COGS / Cr. مخزون
  }
};
```

---

#### 6. لوحة التقارير المحاسبية
**الملف**: `src/features/reports/AccountingReportsPage.tsx`

**التقارير**:

**أ. ميزان المراجعة:**
```typescript
import { getTrialBalance } from '@/services/accounting-service';

const TrialBalanceReport = () => {
  const [data, setData] = useState(null);
  
  const loadReport = async () => {
    const result = await getTrialBalance(fromDate, toDate);
    setData(result);
  };
  
  return (
    <div>
      <h2>ميزان المراجعة</h2>
      <Table>
        {/* عرض الحسابات مع المدين والدائن */}
      </Table>
      <div>
        <strong>مجموع المدين: {data.totals.totalDebit}</strong>
        <strong>مجموع الدائن: {data.totals.totalCredit}</strong>
        {data.isBalanced ? '✅ متوازن' : '❌ غير متوازن'}
      </div>
    </div>
  );
};
```

**ب. قائمة الدخل:**
```typescript
import { getIncomeStatement } from '@/services/accounting-service';

const IncomeStatementReport = () => {
  const [data, setData] = useState(null);
  
  const loadReport = async () => {
    const result = await getIncomeStatement(fromDate, toDate);
    setData(result);
  };
  
  return (
    <div>
      <h2>قائمة الدخل</h2>
      <div>
        <h3>الإيرادات</h3>
        {data.revenues.map(r => <div>{r.account_name}: {r.amount}</div>)}
        <strong>إجمالي الإيرادات: {data.totalRevenue}</strong>
      </div>
      <div>
        <h3>المصروفات</h3>
        {data.expenses.map(e => <div>{e.account_name}: {e.amount}</div>)}
        <strong>إجمالي المصروفات: {data.totalExpense}</strong>
      </div>
      <div className="net-income">
        <strong>صافي الدخل: {data.netIncome}</strong>
        <span>نسبة الربح: {data.profitMargin}%</span>
      </div>
    </div>
  );
};
```

**ج. الميزانية العمومية:**
```typescript
import { getBalanceSheet } from '@/services/accounting-service';

const BalanceSheetReport = () => {
  const [data, setData] = useState(null);
  
  const loadReport = async () => {
    const result = await getBalanceSheet(asOfDate);
    setData(result);
  };
  
  return (
    <div className="balance-sheet">
      <div className="assets">
        <h3>الأصول</h3>
        {data.assets.map(a => <div>{a.account_name}: {a.balance}</div>)}
        <strong>مجموع الأصول: {data.totalAssets}</strong>
      </div>
      <div className="liabilities-equity">
        <h3>الخصوم</h3>
        {data.liabilities.map(l => <div>{l.account_name}: {l.balance}</div>)}
        <strong>مجموع الخصوم: {data.totalLiabilities}</strong>
        
        <h3>حقوق الملكية</h3>
        {data.equity.map(e => <div>{e.account_name}: {e.balance}</div>)}
        <strong>مجموع حقوق الملكية: {data.totalEquity}</strong>
      </div>
      <div className="balance-check">
        {data.isBalanced ? '✅ الميزانية متوازنة' : '❌ الميزانية غير متوازنة'}
      </div>
    </div>
  );
};
```

---

## 📋 الخطوة 3: الاختبار الشامل

### سيناريو الاختبار الكامل:

#### 1. دورة المشتريات:
```
✅ إنشاء أمر شراء لـ 1,000 وحدة @ 5.20 ريال
✅ استلام البضائع → تحقق من تحديث AVCO
✅ إنشاء فاتورة المورد → تحقق من القيد المحاسبي
✅ دفعة للمورد → تحقق من القيد المحاسبي
```

#### 2. دورة المبيعات:
```
✅ إنشاء فاتورة مبيعات لـ 300 وحدة @ 7.00 ريال
✅ تسليم البضائع → تحقق من COGS وقيد المخزون
✅ حساب الربح → تحقق من الربح الفعلي
✅ تحصيل من العميل → تحقق من القيد المحاسبي
```

#### 3. التقارير:
```
✅ ميزان المراجعة → تحقق من التوازن
✅ قائمة الدخل → تحقق من صافي الدخل
✅ الميزانية العمومية → تحقق من التوازن
```

### استخدام ملف الاختبار:
```typescript
// افتح: test-services.ts
// عدّل المعرفات التجريبية بمعرفات حقيقية من قاعدة البيانات
// ثم شغّل:
await runAllTests();
```

---

## 📋 الخطوة 4: التكامل مع BOM

بعد التأكد من عمل المشتريات والمبيعات:

1. اختبر استهلاك المواد من أوامر التصنيع
2. تحقق من تحديث AVCO عند استهلاك المواد
3. تحقق من تحديث AVCO عند إنتاج منتجات نهائية
4. تحقق من القيود المحاسبية للتصنيع

---

## 📊 المراجع السريعة

### الملفات المهمة:
- `src/services/purchasing-service.ts` - خدمة المشتريات
- `src/services/sales-service.ts` - خدمة المبيعات
- `src/services/accounting-service.ts` - خدمة المحاسبة
- `create-procurement-sales-tables.sql` - جداول قاعدة البيانات
- `READY_TO_USE.md` - دليل الاستخدام الكامل
- `SUMMARY.md` - ملخص شامل مع أمثلة

### الوظائف الرئيسية:

**المشتريات**:
- `createPurchaseOrder()`
- `receiveGoods()` ← AVCO
- `createSupplierInvoice()` ← GL Entry
- `recordSupplierPayment()` ← GL Entry

**المبيعات**:
- `createSalesInvoice()` ← GL Entry
- `deliverGoods()` ← AVCO + COGS + GL Entry
- `recordCustomerCollection()` ← GL Entry
- `calculateInvoiceProfit()` ← Profit Analysis

**المحاسبة**:
- `getTrialBalance()`
- `getIncomeStatement()`
- `getBalanceSheet()`
- `getGeneralJournal()`
- `getAccountStatement()`

---

## ✅ التحقق النهائي

قبل البدء بالخطوات التالية، تأكد من:

- [x] جميع الخدمات مطورة (purchasing, sales, accounting)
- [x] التكامل مع AVCO جاهز
- [x] القيود المحاسبية التلقائية جاهزة
- [x] التقارير المحاسبية جاهزة
- [x] SQL للجداول جاهز
- [x] التوثيق كامل
- [ ] تنفيذ SQL في Supabase
- [ ] تطوير واجهات المستخدم
- [ ] الاختبار الشامل

---

**الحالة الحالية**: 🟢 **جاهز للتنفيذ**  
**الخطوة التالية**: 📊 **تنفيذ SQL في Supabase**

بالتوفيق! 🚀
