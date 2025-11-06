# 📋 خطة تطوير موديولات المشتريات والمبيعات
## لضمان دورة مستندية محاسبية سليمة مع نظام AVCO

---

## 🎯 الهدف الرئيسي
تطوير دورة مستندية متكاملة تربط:
- **المشتريات** → تحديث المخزون بـ AVCO → قيود محاسبية
- **المبيعات** → خصم المخزون بـ AVCO → احتساب COGS → قيود محاسبية
- **التكامل** مع نظام التصنيع والـ BOM

---

## 📊 الوضع الحالي

### ✅ موجود ومجهز:
1. **Vendors/Suppliers Table** - جدول الموردين
2. **Customers Table** - جدول العملاء  
3. **Purchase Orders Table** - أوامر الشراء
4. **Sales Orders Table** - فواتير المبيعات
5. **Products Table** - مع دعم AVCO (`cost_price`)
6. **دوال AVCO** - `calculateNewAVCO()`, `recordInventoryMovement()`

### ⚠️ يحتاج تطوير:
1. **Purchase Order Lines** - بنود أمر الشراء
2. **Goods Receipt** - استلام البضائع
3. **Purchase Invoices** - فواتير الموردين
4. **Sales Order Lines** - بنود فاتورة المبيعات
5. **Delivery Notes** - مذكرات التسليم
6. **Stock Movements Integration** - ربط الحركات بالمخزون
7. **Accounting Integration** - القيود المحاسبية التلقائية

---

## 🔄 الدورة المستندية المطلوبة

### 1️⃣ دورة المشتريات (Procurement Cycle)

```
┌─────────────────┐
│ Purchase Order  │  أمر شراء
│ (Draft)         │
└────────┬────────┘
         │ إنشاء أمر شراء
         │ Product + Quantity + Unit Cost
         ↓
┌─────────────────┐
│ PO Confirmed    │  أمر مؤكد
│                 │
└────────┬────────┘
         │ إرسال للمورد
         ↓
┌─────────────────┐
│ Goods Receipt   │  استلام البضائع
│ (GRN)           │  ★ تحديث المخزون
└────────┬────────┘  ★ حساب AVCO جديد
         │ استلام فعلي + فحص
         │
         │ AVCO Calculation:
         │ Old Stock: 100 units × 10 SAR = 1,000 SAR
         │ New Stock: 50 units × 12 SAR = 600 SAR
         │ ────────────────────────────────────────
         │ Total: 150 units × 10.67 SAR = 1,600 SAR ✅
         │
         ↓
┌─────────────────┐
│ Supplier Invoice│  فاتورة المورد
│                 │  ★ قيد محاسبي
└────────┬────────┘
         │ Dr. المخزون (600 SAR)
         │ Dr. ضريبة مضافة (90 SAR @ 15%)
         │ Cr. الموردين (690 SAR)
         ↓
┌─────────────────┐
│ Payment Voucher │  سند صرف
│                 │  ★ قيد محاسبي
└─────────────────┘
         Dr. الموردين (690 SAR)
         Cr. البنك (690 SAR)
```

### 2️⃣ دورة المبيعات (Sales Cycle)

```
┌─────────────────┐
│ Sales Quotation │  عرض سعر (اختياري)
│                 │
└────────┬────────┘
         │ موافقة العميل
         ↓
┌─────────────────┐
│ Sales Invoice   │  فاتورة مبيعات
│ (Draft)         │
└────────┬────────┘
         │ إنشاء فاتورة
         │ Product + Quantity + Selling Price
         ↓
┌─────────────────┐
│ Invoice Confirm │  فاتورة مؤكدة
│                 │  ★ قيد محاسبي
└────────┬────────┘
         │ Dr. العملاء (1,150 SAR)
         │ Cr. المبيعات (1,000 SAR)
         │ Cr. ضريبة مضافة (150 SAR @ 15%)
         ↓
┌─────────────────┐
│ Delivery Note   │  مذكرة تسليم
│                 │  ★ خصم المخزون
└────────┬────────┘  ★ حساب COGS
         │
         │ AVCO Costing:
         │ Current Stock: 150 units × 10.67 SAR
         │ Sale: 30 units
         │ ────────────────────────────────────────
         │ COGS = 30 × 10.67 = 320 SAR ✅
         │ Remaining: 120 units × 10.67 = 1,280 SAR
         │
         │ قيد محاسبي COGS:
         │ Dr. تكلفة البضاعة المباعة (320 SAR)
         │ Cr. المخزون (320 SAR)
         ↓
┌─────────────────┐
│ Collection      │  تحصيل
│ (Payment)       │  ★ قيد محاسبي
└─────────────────┘
         Dr. البنك/الصندوق (1,150 SAR)
         Cr. العملاء (1,150 SAR)
```

---

## 🗄️ هيكل قاعدة البيانات المطلوب

### جداول المشتريات:

```sql
-- 1. جدول أوامر الشراء (موجود)
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    vendor_id UUID REFERENCES vendors(id),
    order_date DATE NOT NULL,
    delivery_date DATE,
    status VARCHAR(20) CHECK (status IN ('draft', 'confirmed', 'received', 'cancelled')),
    total_amount DECIMAL(12,2),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. جدول بنود أمر الشراء (يحتاج إنشاء)
CREATE TABLE purchase_order_lines (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    product_id UUID REFERENCES products(id),
    description TEXT,
    quantity DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(12,4) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_percent DECIMAL(5,2) DEFAULT 15,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (
        quantity * unit_price * (1 - discount_percent/100) * (1 + tax_percent/100)
    ) STORED,
    received_quantity DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(purchase_order_id, line_number)
);

-- 3. جدول استلام البضائع (يحتاج إنشاء)
CREATE TABLE goods_receipts (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    receipt_number VARCHAR(50) UNIQUE NOT NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id),
    vendor_id UUID REFERENCES vendors(id),
    receipt_date DATE NOT NULL,
    status VARCHAR(20) CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. جدول بنود استلام البضائع (يحتاج إنشاء)
CREATE TABLE goods_receipt_lines (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    receipt_id UUID REFERENCES goods_receipts(id) ON DELETE CASCADE,
    po_line_id UUID REFERENCES purchase_order_lines(id),
    product_id UUID REFERENCES products(id),
    quantity_received DECIMAL(12,2) NOT NULL,
    unit_cost DECIMAL(12,4) NOT NULL,  -- التكلفة الفعلية عند الاستلام
    quality_status VARCHAR(20) CHECK (quality_status IN ('approved', 'rejected', 'pending')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. جدول فواتير الموردين (يحتاج إنشاء)
CREATE TABLE supplier_invoices (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_invoice_number VARCHAR(50),  -- رقم فاتورة المورد
    vendor_id UUID REFERENCES vendors(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    receipt_id UUID REFERENCES goods_receipts(id),
    invoice_date DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    balance DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    status VARCHAR(20) CHECK (status IN ('draft', 'posted', 'paid', 'cancelled')),
    gl_entry_id UUID,  -- ربط بالقيد المحاسبي
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### جداول المبيعات:

```sql
-- 1. جدول فواتير المبيعات (موجود - يحتاج تحديث)
CREATE TABLE sales_invoices (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id),
    invoice_date DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    balance DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    status VARCHAR(20) CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    delivery_status VARCHAR(20) CHECK (delivery_status IN ('pending', 'partial', 'delivered')),
    gl_entry_id UUID,  -- ربط بقيد الإيرادات
    cogs_entry_id UUID,  -- ربط بقيد تكلفة البضاعة المباعة
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. جدول بنود فاتورة المبيعات (يحتاج إنشاء)
CREATE TABLE sales_invoice_lines (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    invoice_id UUID REFERENCES sales_invoices(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    product_id UUID REFERENCES products(id),
    description TEXT,
    quantity DECIMAL(12,2) NOT NULL,
    unit_price DECIMAL(12,4) NOT NULL,
    unit_cost DECIMAL(12,4),  -- متوسط التكلفة AVCO عند البيع
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_percent DECIMAL(5,2) DEFAULT 15,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (
        quantity * unit_price * (1 - discount_percent/100) * (1 + tax_percent/100)
    ) STORED,
    cogs DECIMAL(12,2) GENERATED ALWAYS AS (quantity * COALESCE(unit_cost, 0)) STORED,
    delivered_quantity DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(invoice_id, line_number)
);

-- 3. جدول مذكرات التسليم (يحتاج إنشاء)
CREATE TABLE delivery_notes (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    delivery_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_id UUID REFERENCES sales_invoices(id),
    customer_id UUID REFERENCES customers(id),
    delivery_date DATE NOT NULL,
    driver_name VARCHAR(100),
    vehicle_number VARCHAR(50),
    status VARCHAR(20) CHECK (status IN ('pending', 'in_transit', 'delivered', 'failed')),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. جدول بنود مذكرة التسليم (يحتاج إنشاء)
CREATE TABLE delivery_note_lines (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    delivery_id UUID REFERENCES delivery_notes(id) ON DELETE CASCADE,
    invoice_line_id UUID REFERENCES sales_invoice_lines(id),
    product_id UUID REFERENCES products(id),
    quantity_delivered DECIMAL(12,2) NOT NULL,
    unit_cost_at_delivery DECIMAL(12,4),  -- AVCO عند التسليم
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🔧 الدوال البرمجية المطلوبة

### 1. دوال المشتريات:

```typescript
// services/purchasing-service.ts

/**
 * إنشاء أمر شراء مع البنود
 */
export async function createPurchaseOrder(orderData: {
  vendor_id: string
  order_date: string
  delivery_date?: string
  lines: Array<{
    product_id: string
    quantity: number
    unit_price: number
    discount_percent?: number
  }>
  notes?: string
}) {
  // 1. إنشاء أمر الشراء
  // 2. إنشاء البنود
  // 3. حساب الإجمالي
  // 4. إرجاع أمر الشراء الكامل
}

/**
 * استلام بضائع من أمر شراء
 * ★ تحديث المخزون باستخدام AVCO
 */
export async function receiveGoods(receiptData: {
  purchase_order_id: string
  receipt_date: string
  lines: Array<{
    po_line_id: string
    product_id: string
    quantity_received: number
    unit_cost: number  // التكلفة الفعلية
    quality_status: 'approved' | 'rejected'
  }>
}) {
  // 1. إنشاء سند استلام
  // 2. لكل منتج مستلم:
  for (const line of receiptData.lines) {
    if (line.quality_status === 'approved') {
      // 3. حساب AVCO الجديد
      await recordInventoryMovement({
        itemId: line.product_id,
        moveType: 'PURCHASE_IN',
        qtyIn: line.quantity_received,
        unitCost: line.unit_cost,
        referenceType: 'goods_receipt',
        referenceId: receiptId
      })
      
      // 4. تحديث الكمية المستلمة في بند أمر الشراء
    }
  }
  
  // 5. تحديث حالة أمر الشراء
  // 6. إرجاع سند الاستلام
}

/**
 * إنشاء فاتورة مورد
 * ★ إنشاء قيد محاسبي تلقائي
 */
export async function createSupplierInvoice(invoiceData: {
  vendor_id: string
  purchase_order_id?: string
  receipt_id?: string
  invoice_date: string
  due_date: string
  lines: Array<{
    product_id: string
    quantity: number
    unit_price: number
    tax_percent: number
  }>
}) {
  // 1. إنشاء الفاتورة
  // 2. حساب الإجماليات
  
  // 3. إنشاء قيد محاسبي:
  const journalEntry = {
    entry_date: invoiceData.invoice_date,
    description: `فاتورة مورد ${invoiceNumber}`,
    lines: [
      {
        account_code: '1130',  // المخزون
        debit: subtotal,
        credit: 0
      },
      {
        account_code: '1161',  // ضريبة مضافة قابلة للاسترداد
        debit: taxAmount,
        credit: 0
      },
      {
        account_code: '2101',  // الموردين
        debit: 0,
        credit: totalAmount
      }
    ]
  }
  
  // 4. ربط الفاتورة بالقيد
  // 5. إرجاع الفاتورة
}
```

### 2. دوال المبيعات:

```typescript
// services/sales-service.ts

/**
 * إنشاء فاتورة مبيعات مع البنود
 */
export async function createSalesInvoice(invoiceData: {
  customer_id: string
  invoice_date: string
  due_date?: string
  lines: Array<{
    product_id: string
    quantity: number
    unit_price: number
    discount_percent?: number
  }>
  notes?: string
}) {
  // 1. التحقق من توفر المخزون
  for (const line of invoiceData.lines) {
    const product = await getProduct(line.product_id)
    if (product.stock_quantity < line.quantity) {
      throw new Error(`مخزون غير كافٍ للمنتج ${product.name}`)
    }
  }
  
  // 2. إنشاء الفاتورة والبنود
  // 3. حساب الإجماليات
  
  // 4. إنشاء قيد محاسبي للإيرادات:
  const revenueEntry = {
    entry_date: invoiceData.invoice_date,
    description: `فاتورة مبيعات ${invoiceNumber}`,
    lines: [
      {
        account_code: '1120',  // العملاء
        debit: totalAmount,
        credit: 0
      },
      {
        account_code: '4001',  // إيرادات المبيعات
        debit: 0,
        credit: subtotal
      },
      {
        account_code: '2162',  // ضريبة مضافة مستحقة
        debit: 0,
        credit: taxAmount
      }
    ]
  }
  
  // 5. ربط الفاتورة بالقيد
  // 6. إرجاع الفاتورة
}

/**
 * تسليم بضائع من فاتورة مبيعات
 * ★ خصم المخزون باستخدام AVCO
 * ★ حساب تكلفة البضاعة المباعة
 */
export async function deliverGoods(deliveryData: {
  invoice_id: string
  delivery_date: string
  driver_name?: string
  vehicle_number?: string
  lines: Array<{
    invoice_line_id: string
    product_id: string
    quantity_delivered: number
  }>
}) {
  let totalCOGS = 0
  
  // 1. إنشاء مذكرة تسليم
  // 2. لكل منتج مُسلّم:
  for (const line of deliveryData.lines) {
    // 3. الحصول على متوسط التكلفة الحالي (AVCO)
    const product = await getProduct(line.product_id)
    const avgCost = product.cost_price
    
    // 4. خصم من المخزون
    await recordInventoryMovement({
      itemId: line.product_id,
      moveType: 'SALE_OUT',
      qtyOut: line.quantity_delivered,
      unitCost: avgCost,
      referenceType: 'delivery_note',
      referenceId: deliveryId
    })
    
    // 5. حساب COGS
    const cogs = line.quantity_delivered * avgCost
    totalCOGS += cogs
    
    // 6. تحديث unit_cost في بند الفاتورة
    await updateInvoiceLine(line.invoice_line_id, {
      unit_cost_at_delivery: avgCost,
      delivered_quantity: line.quantity_delivered
    })
  }
  
  // 7. إنشاء قيد محاسبي COGS:
  const cogsEntry = {
    entry_date: deliveryData.delivery_date,
    description: `تكلفة مبيعات - مذكرة تسليم ${deliveryNumber}`,
    lines: [
      {
        account_code: '5001',  // تكلفة البضاعة المباعة
        debit: totalCOGS,
        credit: 0
      },
      {
        account_code: '1130',  // المخزون
        debit: 0,
        credit: totalCOGS
      }
    ]
  }
  
  // 8. ربط بقيد COGS
  // 9. تحديث حالة التسليم في الفاتورة
  // 10. إرجاع مذكرة التسليم
}
```

---

## 📝 خطة التنفيذ (Implementation Plan)

### المرحلة 1: إعداد قاعدة البيانات ✅ (اليوم)
- [ ] إنشاء جداول المشتريات المفقودة
- [ ] إنشاء جداول المبيعات المفقودة
- [ ] إضافة indexes للأداء
- [ ] تفعيل RLS policies

### المرحلة 2: خدمات المشتريات 🔄 (غداً)
- [ ] تطوير `purchasing-service.ts`
- [ ] دالة إنشاء أمر شراء
- [ ] دالة استلام بضائع (مع AVCO)
- [ ] دالة فاتورة مورد (مع قيد محاسبي)
- [ ] واجهة مستخدم محسّنة

### المرحلة 3: خدمات المبيعات (بعد غد)
- [ ] تطوير `sales-service.ts`
- [ ] دالة إنشاء فاتورة مبيعات
- [ ] دالة تسليم بضائع (مع AVCO + COGS)
- [ ] دالة تحصيل (مع قيد محاسبي)
- [ ] واجهة مستخدم محسّنة

### المرحلة 4: التكامل والاختبار
- [ ] اختبار الدورة الكاملة
- [ ] التحقق من قيود المحاسبة
- [ ] التحقق من حسابات AVCO
- [ ] تقارير الحركات

---

## 📊 تقارير مطلوبة

### تقارير المشتريات:
1. تقرير أوامر الشراء (حسب الحالة، المورد، التاريخ)
2. تقرير استلام البضائع
3. أعمار الموردين (Accounts Payable Aging)
4. تحليل أسعار الموردين

### تقارير المبيعات:
1. تقرير فواتير المبيعات (حسب الحالة، العميل، التاريخ)
2. تقرير التسليم
3. أعمار العملاء (Accounts Receivable Aging)
4. تحليل الربحية (المبيعات - COGS)

### تقارير المخزون:
1. تقرير حركة المخزون مع AVCO
2. بطاقة الصنف (Kardex) مع متوسط التكلفة
3. تقييم المخزون (Inventory Valuation)

---

## ✅ معايير النجاح

1. **دقة AVCO**: متوسط التكلفة يُحسب بشكل صحيح مع كل حركة
2. **قيود محاسبية صحيحة**: كل عملية تُنشئ قيود صحيحة
3. **تطابق الأرصدة**: أرصدة المخزون = أرصدة الحسابات
4. **تتبع كامل**: كل حركة مربوطة بمستند مصدر
5. **تقارير دقيقة**: جميع التقارير تعرض بيانات متسقة

---

*تم إعداد هذه الخطة في: 5 نوفمبر 2025*
*نظام: Wardah ERP - Process Costing Module*
