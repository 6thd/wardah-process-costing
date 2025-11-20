# 🚀 Quick Start - نظام تسويات المخزون

## ⏱️ البدء السريع (5 دقائق)

### الخطوة 1️⃣: قاعدة البيانات (دقيقتان)

1. افتح **Supabase SQL Editor**
2. انسخ محتوى `create-stock-adjustment-tables.sql`
3. ألصقه واضغط **Run**
4. انتظر ظهور "Success" ✅

```sql
-- سيتم إنشاء:
✅ stock_adjustments (الجدول الرئيسي)
✅ stock_adjustment_items (بنود التسوية)
✅ physical_count_sessions (جلسات الجرد)
✅ physical_count_items (تفاصيل العد)
✅ 3 Triggers (حسابات تلقائية)
✅ 8 RLS Policies (الأمان)
```

---

### الخطوة 2️⃣: إضافة الحسابات المحاسبية (دقيقة)

```sql
-- في Supabase SQL Editor أيضاً:

-- استبدل 'YOUR-ORG-ID' بمعرف مؤسستك
DO $$
DECLARE
  org_id UUID := 'YOUR-ORG-ID'::UUID;
BEGIN

-- حساب مصروف التسويات
INSERT INTO gl_accounts (
  organization_id, account_code, account_name, 
  account_name_en, account_type, parent_code
) VALUES (
  org_id, '5950', 'تسويات المخزون',
  'Inventory Adjustments', 'EXPENSE', '5000'
) ON CONFLICT (organization_id, account_code) DO NOTHING;

-- حساب إيرادات أخرى
INSERT INTO gl_accounts (
  organization_id, account_code, account_name,
  account_name_en, account_type, parent_code
) VALUES (
  org_id, '4900', 'إيرادات أخرى',
  'Other Income', 'REVENUE', '4000'
) ON CONFLICT (organization_id, account_code) DO NOTHING;

END $$;
```

**للحصول على organization_id:**
```sql
SELECT id, name FROM organizations WHERE name LIKE '%اسم مؤسستك%';
```

---

### الخطوة 3️⃣: اختبار الواجهة (دقيقتان)

1. افتح التطبيق
2. اذهب إلى: **المخزون** → **تسويات المخزون**
3. اضغط **"تسوية جديدة"**
4. املأ البيانات:
   ```
   التاريخ: [اليوم]
   النوع: [جرد فعلي]
   السبب: "اختبار النظام"
   ```
5. أضف منتج:
   - ابحث عن منتج
   - أدخل الكمية الجديدة
   - لاحظ الحساب التلقائي
6. اضغط **"حفظ كمسودة"**

---

## 📋 مثال عملي كامل

### السيناريو: جرد سنوي وجدت فيه فروقات

```typescript
// 1. إنشاء التسوية
const adjustment = {
  adjustment_date: '2024-01-15',
  adjustment_type: 'PHYSICAL_COUNT',
  reason: 'الجرد السنوي لعام 2024 - وجدت فروقات',
  items: [
    {
      product_id: 'product-1-uuid',
      current_qty: 100,    // ما في النظام
      new_qty: 95,         // ما تم عده
      // سيحسب تلقائياً:
      // difference_qty: -5
      // value_difference: -250.00 (إذا السعر 50)
      reason: 'كسر أثناء التخزين'
    },
    {
      product_id: 'product-2-uuid',
      current_qty: 50,
      new_qty: 55,
      // difference_qty: +5
      // value_difference: +150.00 (إذا السعر 30)
      reason: 'وجد كرتون إضافي في المستودع'
    }
  ]
}

// 2. حفظ كمسودة
const created = await stockAdjustmentService.createAdjustment(adjustment)
// النتيجة: adjustment_number = "ADJ-000001"

// 3. مراجعة ثم الترحيل
await stockAdjustmentService.submitAdjustment(created.id)

// ما سيحدث تلقائياً:
✅ stock_ledger_entries (2 سطر)
✅ تحديث products (stock_quantity, stock_value)
✅ journal_entry مع 4 أسطر:
   Dr. 5950 (Inventory Adjustments) = 250.00
      Cr. 1410 (Inventory Asset)    = 250.00
   Dr. 1410 (Inventory Asset)       = 150.00
      Cr. 4900 (Other Income)        = 150.00
```

---

## 🎯 حالات استخدام شائعة

### 1. جرد فعلي (Physical Count)
```
النوع: PHYSICAL_COUNT
متى: نهاية السنة، نهاية الشهر
المعالجة: زيادة → إيرادات أخرى
          نقص → مصروف تسويات
```

### 2. تلف (Damage)
```
النوع: DAMAGE
متى: اكتشاف منتج تالف
المعالجة: دائماً نقص → مصروف تسويات
السبب: "كسر أثناء النقل", "تلف من الرطوبة"
```

### 3. فقد/سرقة (Theft)
```
النوع: THEFT
متى: اكتشاف نقص غير مبرر
المعالجة: نقص → مصروف تسويات
السبب: "فقد أثناء الجرد", "سرقة محتملة"
```

### 4. منتهي الصلاحية (Expiry)
```
النوع: EXPIRY
متى: إتلاف منتجات منتهية
المعالجة: نقص → مصروف تسويات
السبب: "انتهاء الصلاحية - Batch #123"
```

---

## 🔍 كيف تتحقق من صحة العمل

### 1. تحقق من stock_ledger_entries:
```sql
SELECT 
  sle.posting_date,
  sle.voucher_type,
  sle.voucher_no,
  p.name as product_name,
  sle.actual_qty,
  sle.qty_after_transaction,
  sle.stock_value_difference
FROM stock_ledger_entries sle
JOIN products p ON sle.item_code = p.code
WHERE sle.voucher_type = 'Stock Adjustment'
ORDER BY sle.posting_date DESC, sle.posting_time DESC
LIMIT 10;
```

### 2. تحقق من القيود المحاسبية:
```sql
SELECT 
  je.entry_date,
  je.voucher_type,
  je.reference_number,
  ga.account_code,
  ga.account_name,
  jel.debit_amount,
  jel.credit_amount
FROM journal_entries je
JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
JOIN gl_accounts ga ON jel.account_id = ga.id
WHERE je.reference_type = 'Stock Adjustment'
ORDER BY je.entry_date DESC, jel.line_number;
```

### 3. تحقق من أرصدة المنتجات:
```sql
SELECT 
  code,
  name,
  stock_quantity,
  cost_price,
  stock_value,
  (stock_quantity * cost_price) as calculated_value,
  stock_value - (stock_quantity * cost_price) as variance
FROM products
WHERE stock_quantity > 0
ORDER BY ABS(stock_value - (stock_quantity * cost_price)) DESC
LIMIT 20;
```

---

## 🐛 استكشاف الأخطاء

### المشكلة: "Cannot find module stock-adjustment-service"
**الحل:**
```typescript
// تأكد من المسار الصحيح في inventory/index.tsx
import { stockAdjustmentService } from '@/services/stock-adjustment-service'
```

### المشكلة: "relation stock_adjustments does not exist"
**الحل:** لم يتم تطبيق SQL script
```bash
1. افتح Supabase SQL Editor
2. نفذ: create-stock-adjustment-tables.sql
```

### المشكلة: "Account not found: 5950"
**الحل:** لم يتم إضافة الحسابات
```sql
-- نفذ الخطوة 2 أعلاه (إضافة الحسابات)
```

### المشكلة: "Permission denied for table stock_adjustments"
**الحل:** مشكلة RLS
```sql
-- تحقق من RLS policies
SELECT * FROM pg_policies WHERE tablename = 'stock_adjustments';

-- تأكد من وجود user_organizations
SELECT * FROM user_organizations WHERE user_id = auth.uid();
```

---

## 📊 SQL Queries مفيدة

### 1. عدد التسويات حسب النوع:
```sql
SELECT 
  adjustment_type,
  COUNT(*) as count,
  SUM(total_value_difference) as total_impact
FROM stock_adjustments
WHERE status = 'SUBMITTED'
  AND adjustment_date >= DATE_TRUNC('year', CURRENT_DATE)
GROUP BY adjustment_type
ORDER BY ABS(SUM(total_value_difference)) DESC;
```

### 2. أكثر المنتجات تسوية:
```sql
SELECT 
  p.code,
  p.name,
  COUNT(DISTINCT sai.adjustment_id) as adjustments_count,
  SUM(ABS(sai.difference_qty)) as total_qty_adjusted,
  SUM(ABS(sai.value_difference)) as total_value_adjusted
FROM stock_adjustment_items sai
JOIN products p ON sai.product_id = p.id
JOIN stock_adjustments sa ON sai.adjustment_id = sa.id
WHERE sa.status = 'SUBMITTED'
  AND sa.adjustment_date >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY p.id
ORDER BY total_value_adjusted DESC
LIMIT 10;
```

### 3. التسويات التي تحتاج موافقة:
```sql
SELECT 
  adjustment_number,
  adjustment_date,
  adjustment_type,
  total_value_difference,
  reason,
  CASE 
    WHEN approved_by IS NOT NULL THEN 'تمت الموافقة'
    ELSE 'في انتظار الموافقة'
  END as approval_status
FROM stock_adjustments
WHERE requires_approval = TRUE
  AND status = 'DRAFT'
ORDER BY ABS(total_value_difference) DESC;
```

---

## ✅ Checklist قبل الإنتاج

- [ ] تطبيق SQL schema
- [ ] إضافة الحسابات المحاسبية (5950, 4900)
- [ ] اختبار إنشاء تسوية
- [ ] اختبار الترحيل
- [ ] التحقق من stock_ledger_entries
- [ ] التحقق من journal_entries
- [ ] التحقق من تحديث products
- [ ] اختبار الإلغاء (cancellation)
- [ ] اختبار الموافقات (> 10,000)
- [ ] مراجعة RLS policies

---

## 📞 المراجع السريعة

- **التوثيق الكامل:** `STOCK_ADJUSTMENTS_IMPLEMENTATION.md`
- **الملخص:** `STOCK_ADJUSTMENTS_SUMMARY.md`
- **SQL Schema:** `create-stock-adjustment-tables.sql`
- **Backend Service:** `src/services/stock-adjustment-service.ts`
- **Frontend:** `src/features/inventory/index.tsx`

---

## 🎉 جاهز للعمل!

بعد تطبيق الخطوات الثلاث الأولى، النظام جاهز تماماً للاستخدام.

**وقت التطبيق:** 5 دقائق
**مستوى التعقيد:** بسيط
**النتيجة:** نظام احترافي كامل

---

*ابدأ الآن واستمتع بنظام تسويات مخزون عالمي المستوى! 🚀*
