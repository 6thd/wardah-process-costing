# تعليمات إصلاح دالة توليد رقم القيد
# Instructions to Fix Entry Number Generation

## المشكلة / Problem
- الدالة `generate_entry_number` غير موجودة في قاعدة البيانات
- الـ sequences المطلوبة غير موجودة
- خطأ 404 عند محاولة استدعاء الدالة من التطبيق

## الحل / Solution

### الخطوة 1: فتح Supabase SQL Editor
1. افتح لوحة تحكم Supabase
2. اذهب إلى **SQL Editor** من القائمة الجانبية
3. اضغط على **New query** لإنشاء استعلام جديد

### الخطوة 2: نسخ ولصق الكود
1. افتح الملف `create-entry-number-function.sql`
2. انسخ **كل** محتويات الملف
3. الصق في SQL Editor

### الخطوة 3: تنفيذ الكود
1. اضغط على زر **Run** أو اضغط `Ctrl + Enter`
2. انتظر حتى يكتمل التنفيذ
3. يجب أن ترى رسالة نجاح: `Function created successfully!`

### الخطوة 4: التحقق من النجاح
بعد تنفيذ الكود، قم بتشغيل هذا الاستعلام للتحقق:

```sql
-- التحقق من وجود الدالة
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'generate_entry_number';

-- اختبار الدالة
SELECT generate_entry_number(
    (SELECT id FROM journals LIMIT 1)
) as test_entry_number;
```

يجب أن ترى رقم قيد مثل: `GJ-2025-000001`

### الخطوة 5: اختبار من التطبيق
1. ارجع إلى صفحة قيود اليومية
2. أنشئ قيد جديد
3. اختر نوع القيد (Journal Type)
4. أدخل المدين والدائن
5. اضغط حفظ
6. يجب أن يتم الحفظ بنجاح بدون أخطاء!

---

## What the SQL Does / ماذا يفعل الكود

### 1. Creates the Function
```sql
CREATE FUNCTION generate_entry_number(p_journal_id UUID)
```
- تنشئ الدالة التي تولد رقم القيد تلقائياً
- تستخدم معرف الدفتر (journal_id) لتحديد البادئة

### 2. Creates Sequences
```sql
CREATE SEQUENCE seq_gj, seq_si, seq_pi, etc.
```
- تنشئ متتاليات الأرقام لكل نوع دفتر
- GJ = General Journal (قيد يومية عام)
- SI = Sales Invoice (فاتورة مبيعات)
- PI = Purchase Invoice (فاتورة مشتريات)
- CR = Cash Receipt (سند قبض نقدي)
- CP = Cash Payment (سند صرف نقدي)
- BR = Bank Receipt (سند قبض بنكي)
- BP = Bank Payment (سند صرف بنكي)

### 3. Entry Number Format
```
PREFIX-YEAR-NUMBER
Example: GJ-2025-000001
```

### 4. Grants Permissions
```sql
GRANT EXECUTE ON FUNCTION...
```
- تمنح صلاحيات تنفيذ الدالة للمستخدمين

---

## التحقق من حل المشكلة / Verify the Fix

### Before (قبل):
```
❌ POST .../rpc/generate_entry_number 404 (Not Found)
❌ relation "seq_gj_00000000..." does not exist
```

### After (بعد):
```
✅ Function executed successfully
✅ Entry saved with number: GJ-2025-000001
✅ Journal entry created
```

---

## إذا استمرت المشكلة / If Problem Persists

### تحقق من الصلاحيات:
```sql
-- منح صلاحيات على الـ sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
```

### تحقق من RLS (Row Level Security):
```sql
-- تعطيل RLS على جدول journals مؤقتاً للاختبار
ALTER TABLE journals DISABLE ROW LEVEL SECURITY;
```

### تنظيف الـ sequences وإعادة إنشائها:
```sql
-- حذف الـ sequences القديمة
DROP SEQUENCE IF EXISTS seq_gj CASCADE;
DROP SEQUENCE IF EXISTS seq_si CASCADE;
DROP SEQUENCE IF EXISTS seq_pi CASCADE;

-- إعادة إنشائها
CREATE SEQUENCE seq_gj START WITH 1;
CREATE SEQUENCE seq_si START WITH 1;
CREATE SEQUENCE seq_pi START WITH 1;
```

---

## نصائح إضافية / Additional Tips

1. **نسخ احتياطي**: قبل تنفيذ أي SQL، خذ نسخة احتياطية من البيانات المهمة
2. **البيئة**: نفذ أولاً في بيئة الاختبار إن وجدت
3. **السجلات**: راجع Supabase Logs إذا استمرت المشكلة
4. **الدعم**: إذا واجهت مشكلة، أرسل لي رسالة الخطأ كاملة

---

## ملاحظات تقنية / Technical Notes

- الدالة تستخدم `SECURITY DEFINER` لضمان تنفيذها بصلاحيات المنشئ
- الـ sequences تبدأ من 1 وتزيد تلقائياً
- التسلسل منفصل لكل نوع دفتر (GJ, SI, PI, etc.)
- الأسماء مبسطة لتجنب مشاكل الـ org_id الطويلة

---

**✅ بعد تنفيذ هذا الكود، يجب أن يعمل حفظ القيود بشكل كامل!**

**✅ After running this SQL, journal entry saving should work perfectly!**
