# BOM Enhancements - دليل التنفيذ
# BOM Enhancements Implementation Guide

## نظرة عامة

هذا الدليل يشرح كيفية تنفيذ تحسينات BOM الأربعة في قاعدة البيانات.

## ترتيب التنفيذ

**⚠️ مهم جداً:** يجب تنفيذ ملفات SQL بالترتيب التالي:

### 1. Multi-Level BOM Visualization
```sql
-- ملف: sql/manufacturing/03_bom_tree_visualization.sql
```
**ما يتم إنشاؤه:**
- جدول `bom_tree_cache` - تخزين مؤقت للشجرة
- جدول `bom_settings` - إعدادات BOM
- دالة `build_bom_tree()` - بناء الشجرة
- دالة `cleanup_bom_tree_cache()` - تنظيف cache

### 2. BOM Costing Enhancement
```sql
-- ملف: sql/manufacturing/04_bom_costing_enhancements.sql
```
**ما يتم إنشاؤه:**
- جدول `bom_cost_analysis` - تحليل التكلفة
- جدول `bom_cost_details` - تفاصيل التكلفة
- دالة `calculate_bom_standard_cost()` - حساب التكلفة المعيارية
- دالة `compare_bom_costs()` - مقارنة التكاليف

### 3. Alternative BOMs
```sql
-- ملف: sql/manufacturing/05_alternative_boms.sql
```
**ما يتم إنشاؤه:**
- جدول `bom_alternatives` - BOMs البديلة
- جدول `bom_selection_rules` - قواعد الاختيار
- دالة `select_optimal_bom()` - اختيار BOM الأمثل

### 4. BOM Routing
```sql
-- ملف: sql/manufacturing/06_bom_routing.sql
```
**ما يتم إنشاؤه:**
- جدول `bom_operations` - عمليات التصنيع
- جدول `bom_operation_materials` - ربط العمليات بالمواد
- دالة `calculate_routing_cost()` - حساب تكلفة Routing
- دالة `calculate_total_routing_cost()` - حساب الإجمالي

## خطوات التنفيذ

### في Supabase Dashboard

1. افتح **SQL Editor**
2. انسخ محتوى كل ملف SQL بالترتيب
3. نفذ كل ملف على حدة
4. تحقق من عدم وجود أخطاء

### أو باستخدام CLI

```bash
# تنفيذ بالترتيب
psql -h your-host -U your-user -d your-database -f sql/manufacturing/03_bom_tree_visualization.sql
psql -h your-host -U your-user -d your-database -f sql/manufacturing/04_bom_costing_enhancements.sql
psql -h your-host -U your-user -d your-database -f sql/manufacturing/05_alternative_boms.sql
psql -h your-host -U your-user -d your-database -f sql/manufacturing/06_bom_routing.sql
```

## التحقق من التنفيذ

بعد تنفيذ كل ملف، تحقق من:

```sql
-- 1. التحقق من الجداول
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'bom_tree_cache',
  'bom_settings',
  'bom_cost_analysis',
  'bom_cost_details',
  'bom_alternatives',
  'bom_selection_rules',
  'bom_operations',
  'bom_operation_materials'
);

-- 2. التحقق من الدوال
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'build_bom_tree',
  'cleanup_bom_tree_cache',
  'calculate_bom_standard_cost',
  'compare_bom_costs',
  'select_optimal_bom',
  'calculate_routing_cost',
  'calculate_total_routing_cost'
);

-- 3. اختبار دالة build_bom_tree (إذا كان لديك BOM)
-- SELECT * FROM build_bom_tree('your-bom-id'::UUID, 1, NULL, false);
```

## ملاحظات مهمة

### 1. التبعيات
- يجب أن تكون الجداول الأساسية موجودة:
  - `bom_headers`
  - `bom_lines`
  - `items` أو `products`
  - `work_centers` (لـ Routing)

### 2. RLS Policies
- قد تحتاج لإضافة RLS Policies للجداول الجديدة
- راجع ملفات SQL الأصلية للسياسات

### 3. Indexes
- تم إنشاء Indexes تلقائياً في ملفات SQL
- يمكن إضافة المزيد حسب الحاجة

### 4. الإعدادات الافتراضية
- سيتم إنشاء إعدادات افتراضية في `bom_settings` عند أول استخدام
- يمكن تحديثها من واجهة الإعدادات

## استكشاف الأخطاء

### خطأ: جدول موجود بالفعل
```sql
-- استخدم IF NOT EXISTS في CREATE TABLE
-- أو احذف الجدول أولاً إذا كنت تريد إعادة الإنشاء
DROP TABLE IF EXISTS bom_tree_cache CASCADE;
```

### خطأ: دالة موجودة بالفعل
```sql
-- استخدم CREATE OR REPLACE FUNCTION
-- هذا موجود بالفعل في الملفات
```

### خطأ: Foreign Key
```sql
-- تأكد من وجود الجداول المرجعية
-- تحقق من وجود bom_headers و items/products
```

## الدعم

للمزيد من المعلومات:
- راجع `BOM_ENHANCEMENTS_DOCUMENTATION.md`
- راجع ملفات SQL للتعليقات
- راجع ملفات TypeScript Services

---

**تاريخ الإنشاء:** 2025-01-15  
**الإصدار:** 1.0.0

