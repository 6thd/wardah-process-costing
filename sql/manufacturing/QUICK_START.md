# 🚀 دليل التطبيق السريع - BOM System

## الخطوات بالترتيب

### 1️⃣ التحقق من المتطلبات (اختياري لكن موصى به)

```sql
-- شغّل: 00_pre_bom_verification.sql
-- تأكد من وجود جميع الجداول المطلوبة
```

### 2️⃣ تطبيق BOM System

```sql
-- شغّل: 01_bom_system_setup.sql
-- سيتم إنشاء:
-- - جداول bom_headers, bom_lines
-- - جداول bom_versions, bom_explosion_cache, bom_where_used
-- - 3 دوال: explode_bom, calculate_bom_cost, get_where_used
-- - 2 triggers للتحديث التلقائي
-- - سياسات RLS
```

### 3️⃣ حل مشاكل RLS (إذا واجهتك مشاكل)

إذا واجهت أخطاء مع Row Level Security:

```sql
-- الخيار 1: استخدم السياسات المبسطة
-- شغّل: 02_bom_rls_simple.sql

-- الخيار 2: عطّل RLS مؤقتاً
ALTER TABLE bom_headers DISABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE bom_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE bom_explosion_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE bom_where_used DISABLE ROW LEVEL SECURITY;
```

---

## ✅ التحقق من النجاح

بعد التطبيق، شغّل:

```sql
-- 1. التحقق من الجداول
SELECT table_name 
FROM information_schema.tables 
WHERE table_name LIKE '%bom%'
ORDER BY table_name;
-- يجب أن ترى: 5 جداول

-- 2. التحقق من الدوال
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name LIKE '%bom%'
ORDER BY routine_name;
-- يجب أن ترى: 5 دوال

-- 3. اختبار سريع - إنشاء BOM تجريبي
INSERT INTO bom_headers (org_id, bom_number, item_id, quantity)
VALUES (
    'your-org-id'::UUID, 
    'BOM-TEST-001', 
    'your-item-id'::UUID, 
    1
);
```

---

## 🐛 الأخطاء الشائعة وحلولها

### خطأ: "relation does not exist"
**الحل:** تأكد من تشغيل السكريبت بالكامل مرة واحدة

### خطأ: "column does not exist"
**الحل:** جدول items قد يستخدم أسماء مختلفة للأعمدة
- السكريبت يدعم: `code` و `item_code`
- السكريبت يدعم: `name` و `item_name`
- السكريبت يدعم: `unit` و `unit_of_measure`

### خطأ: "organization_id does not exist"
**الحل:** تم إصلاحه - السكريبت يستخدم `org_id` الآن

### خطأ: "permission denied for schema auth"
**الحل:** استخدم السكريبت المبسط `02_bom_rls_simple.sql`

---

## 📞 بعد التطبيق

1. ✅ حفظ التغييرات في Git
2. ✅ اختبار النظام في الواجهة
3. ✅ إنشاء BOM تجريبي
4. ✅ اختبار الدوال (explode, cost, where-used)

---

**جاهز للتطبيق؟** 
افتح Supabase → SQL Editor → الصق السكريبت → Run! 🚀
