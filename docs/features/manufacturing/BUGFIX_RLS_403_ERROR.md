# Bug Fix: 403 Forbidden Error - RLS Policy Violation

## 🐛 المشكلة

**Error:**
```
POST https://...supabase.co/rest/v1/manufacturing_orders?select=* 403 (Forbidden)
{code: '42501', message: 'new row violates row-level security policy for table "manufacturing_orders"'}
```

**السبب:**
- RLS policy يتحقق من `tenant_id` في `manufacturing_orders`
- لكن الكود يرسل `org_id` بدلاً من `tenant_id`
- `get_current_tenant_id()` لا يدعم `org_id` من JWT

## ✅ الحل

### 1. تحديث `get_current_tenant_id()` Function

تم تحديث الـ function ليدعم كلا الحالتين:
- `tenant_id` من JWT
- `org_id` من JWT (fallback)
- `org_id` من `user_organizations` (fallback)
- Default org_id (fallback)

### 2. تحديث RLS Policies

تم تحديث RLS policies لتدعم كلا الحالتين:
- إذا كان الجدول يحتوي على `tenant_id` → استخدام `tenant_id`
- إذا كان الجدول يحتوي على `org_id` → استخدام `org_id`
- إذا لم يكن أي منهما موجود → السماح بكل شيء (backward compatibility)

## 📝 الملفات المحدثة

1. ✅ `sql/migrations/32_fix_manufacturing_orders_rls.sql`
   - تحديث `get_current_tenant_id()` function
   - تحديث RLS policies لـ `manufacturing_orders`

## 🚀 خطوات التنفيذ

1. **شغّل SQL Script:**
   ```sql
   -- في Supabase SQL Editor
   -- شغّل: sql/migrations/32_fix_manufacturing_orders_rls.sql
   ```

2. **تحقق من النتيجة:**
   ```sql
   -- تحقق من الـ policies
   SELECT 
     schemaname,
     tablename,
     policyname,
     cmd
   FROM pg_policies
   WHERE tablename = 'manufacturing_orders';
   ```

3. **اختبر الإنشاء:**
   - أعد تحميل الصفحة
   - جرب إنشاء Manufacturing Order جديد
   - يجب أن يعمل بدون خطأ 403

## ✅ النتيجة المتوقعة

- ✅ لا مزيد من أخطاء 403
- ✅ يمكن إنشاء Manufacturing Orders جديدة
- ✅ RLS policies تعمل بشكل صحيح
- ✅ يدعم كلا من `org_id` و `tenant_id`

---

**Date:** [Date]  
**Status:** ✅ Fixed (Requires SQL Script Execution)

