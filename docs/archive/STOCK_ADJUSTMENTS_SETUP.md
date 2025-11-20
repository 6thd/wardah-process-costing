# 🚀 خطوات تفعيل نظام تسويات المخزون

## الخطوة 1: إنشاء الجداول في Supabase

1. افتح **Supabase Dashboard**
2. اذهب إلى **SQL Editor**
3. انسخ محتوى الملف `create-stock-adjustment-tables.sql`
4. ألصقه في SQL Editor
5. اضغط **Run** (أو Ctrl+Enter)
6. انتظر رسالة "Success" ✅

## الخطوة 2: التحقق من الجداول

نفذ هذا الـ SQL للتحقق:

```sql
-- التحقق من وجود الجداول
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'stock_adjustments',
  'stock_adjustment_items',
  'physical_count_sessions',
  'physical_count_items'
);
```

يجب أن ترى 4 جداول ✅

## الخطوة 3: التحقق من الحسابات المحاسبية

```sql
-- التحقق من الحسابات المطلوبة
SELECT account_code, account_name 
FROM gl_accounts 
WHERE account_code IN ('5950', '4900');
```

إذا لم تكن موجودة، أضفها:

```sql
-- استبدل 'YOUR-ORG-ID' بمعرف مؤسستك
INSERT INTO gl_accounts (
  organization_id, account_code, account_name, 
  account_name_en, account_type, parent_code
) VALUES 
(
  'YOUR-ORG-ID'::UUID, '5950', 'تسويات المخزون',
  'Inventory Adjustments', 'EXPENSE', '5000'
),
(
  'YOUR-ORG-ID'::UUID, '4900', 'إيرادات أخرى',
  'Other Income', 'REVENUE', '4000'
)
ON CONFLICT (organization_id, account_code) DO NOTHING;
```

## الخطوة 4: اختبار النظام

1. افتح **المخزون** → **تسويات المخزون**
2. اضغط **تسوية جديدة**
3. املأ البيانات وأضف منتج
4. اضغط **حفظ كمسودة**
5. يجب أن تظهر التسوية في القائمة ✅

## 🐛 استكشاف الأخطاء

### المشكلة: "لا توجد تسويات مخزون بعد"

**الحل 1: تحقق من Console**
```
F12 → Console
ابحث عن رسائل تبدأ بـ:
🔍 Loading adjustments...
✅ User: xxx
✅ Organization: xxx
✅ Loaded adjustments: X
```

**الحل 2: تحقق من البيانات مباشرة**
```sql
SELECT * FROM stock_adjustments ORDER BY created_at DESC LIMIT 5;
```

**الحل 3: تحقق من RLS Policies**
```sql
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE tablename = 'stock_adjustments';
```

### المشكلة: "خطأ في تحميل التسويات"

**السبب المحتمل**: الجداول غير موجودة
**الحل**: نفذ الخطوة 1 أعلاه

### المشكلة: "relation stock_adjustments does not exist"

**السبب**: لم يتم تنفيذ SQL script
**الحل**: نفذ `create-stock-adjustment-tables.sql`

---

## ✅ Checklist

- [ ] تم تنفيذ `create-stock-adjustment-tables.sql`
- [ ] تم التحقق من وجود 4 جداول
- [ ] تم إضافة الحسابات المحاسبية (5950, 4900)
- [ ] تم اختبار إنشاء تسوية
- [ ] التسوية تظهر في القائمة

**إذا اكتملت جميع الخطوات والمشكلة مستمرة، تحقق من Console وأرسل لي الرسائل.**
