# 🚀 ترتيب تنفيذ ملفات SQL

## ⚠️ مهم جداً: اتبع هذا الترتيب بالضبط!

---

## 📋 الملفات الأساسية (Phase 1)

### 1️⃣ حل مشكلة الـ Views (اختياري - إذا ظهر خطأ)
```sql
sql/00a_pre_fix_drop_views.sql
```
**متى تشغله:** إذا ظهر خطأ `cannot update view` عند تشغيل الملف التالي

**ماذا يفعل:**
- يحذف الـ Views المشكلة (v_suggested_warehouse_accounts)
- يتيح لك تشغيل الإصلاحات بدون مشاكل

---

### 2️⃣ الإصلاحات الحرجة (إلزامي)
```sql
sql/00_critical_schema_fixes.sql
```
**ماذا يفعل:**
- ✅ توحيد `org_id` في جميع الجداول
- ✅ إصلاح `gl_accounts` (إضافة `name_ar`, `name_en`, `subtype`)
- ✅ إضافة `is_stockable`, `is_active` إلى `products`
- ✅ إنشاء جدول `items` ونسخ البيانات من `products`
- ✅ تبسيط RLS policies
- ✅ إضافة Indexes للأداء
- ✅ إنشاء Helper Functions

**الوقت المتوقع:** 2-5 دقائق

---

## 📊 ملفات المحاسبة

### 3️⃣ جداول المبيعات
```sql
sql/06_sales_tables_fix.sql
sql/07_sales_schema_fix.sql
sql/08_sales_performance_and_security.sql
```

### 4️⃣ نظام سندات القبض والصرف
```sql
sql/09_payment_vouchers_system.sql
```

---

## 🏭 ملفات التصنيع

### 5️⃣ BOM Enhancements
```sql
sql/manufacturing/03_bom_tree_visualization.sql
sql/manufacturing/04_bom_costing_enhancements.sql
sql/manufacturing/05_alternative_boms.sql
sql/manufacturing/06_bom_routing.sql
```

### 6️⃣ Manufacturing Tables Fix
```sql
sql/manufacturing/07_manufacturing_tables_fix.sql
```

---

## 👥 ملفات الموارد البشرية

### 7️⃣ HR Core Module
```sql
sql/15_hr_module.sql
```

### 8️⃣ HR Extensions
```sql
sql/hr/16_hr_operational_extensions.sql
sql/hr/17_hr_core_extensions.sql
```

---

## ✅ التحقق بعد كل ملف

بعد تشغيل كل ملف، تحقق من:

```sql
-- عدد الجداول المنشأة
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- التحقق من وجود org_id
SELECT table_name 
FROM information_schema.columns 
WHERE column_name = 'org_id' AND table_schema = 'public'
ORDER BY table_name;

-- التحقق من RLS policies
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename;
```

---

## 🔧 في حالة حدوث أخطاء

### خطأ: `cannot update view`
**الحل:** شغّل `sql/00a_pre_fix_drop_views.sql` أولاً

### خطأ: `column does not exist`
**الحل:** الملف محمي ضد هذا! لكن إذا استمر:
1. تحقق من اسم العمود في database
2. أرسل لي رسالة الخطأ كاملة

### خطأ: `relation does not exist`
**الحل:** طبيعي! الملف ينشئ الجداول المفقودة تلقائياً

---

## 📌 ملاحظات مهمة

1. ✅ **النسخ الاحتياطي:** احتفظ بنسخة احتياطية قبل التشغيل
2. ✅ **الترتيب:** اتبع الترتيب بالضبط
3. ✅ **الرسائل:** اقرأ رسائل `NOTICE` في الـ console
4. ✅ **التحقق:** استخدم استعلامات التحقق بعد كل ملف

---

## 🎯 الوقت الإجمالي المتوقع

- Phase 1 (الإصلاحات الأساسية): **5-10 دقائق**
- Phase 2 (باقي الملفات): **10-15 دقيقة**

**المجموع:** حوالي **20 دقيقة**

---

## 📞 الدعم

إذا واجهت أي مشكلة:
1. أرسل رسالة الخطأ كاملة
2. أرسل السطر الذي حدث عنده الخطأ
3. سأساعدك فوراً! 🚀

