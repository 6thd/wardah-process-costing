# Manufacturing Tables Fix - دليل التنفيذ
# Manufacturing Tables Fix Implementation Guide

## المشكلة

يظهر خطأ في قسم التصنيع:
- `Could not find the table 'public.manufacturing_orders'`
- `Could not find the table 'public.work_centers'`
- `Could not find the table 'public.stage_costs'`

## الحل

تنفيذ ملف SQL لإصلاح وإنشاء الجداول المفقودة.

## خطوات التنفيذ

### في Supabase Dashboard

1. افتح **SQL Editor**
2. انسخ محتوى `sql/manufacturing/07_manufacturing_tables_fix.sql`
3. نفذ الملف
4. تحقق من عدم وجود أخطاء

### أو باستخدام CLI

```bash
psql -h your-host -U your-user -d your-database -f sql/manufacturing/07_manufacturing_tables_fix.sql
```

## ما يتم إنشاؤه

### 1. manufacturing_orders
- جدول أوامر التصنيع
- دعم `org_id` و `tenant_id`
- Indexes للأداء

### 2. work_centers
- جدول مراكز العمل
- دعم `org_id` و `tenant_id`
- Indexes للأداء

### 3. stage_costs
- جدول تكاليف المراحل
- دعم `org_id` و `tenant_id`
- Indexes للأداء

## التحقق من التنفيذ

```sql
-- التحقق من الجداول
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'manufacturing_orders',
  'work_centers',
  'stage_costs'
);

-- التحقق من الأعمدة
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'manufacturing_orders' 
AND column_name = 'org_id';
```

## ملاحظات

- الملف آمن للتنفيذ عدة مرات (idempotent)
- لن يحذف البيانات الموجودة
- سيضيف الأعمدة المفقودة فقط
- سيحول `tenant_id` إلى `org_id` إذا لزم الأمر

---

**تاريخ الإنشاء:** 2025-01-15  
**الإصدار:** 1.0.0

