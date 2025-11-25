# Manufacturing Orders Status Constraint Update

## 🐛 المشكلة

**Error:**
```
new row for relation "manufacturing_orders" violates check constraint "manufacturing_orders_status_check"
```

**السبب:**
- قاعدة البيانات تسمح فقط بـ: `'draft', 'confirmed', 'in_progress', 'done', 'cancelled'`
- الكود يستخدم: `'in-progress'` (مع dash) بدلاً من `'in_progress'` (مع underscore)
- الكود يستخدم: `'completed'` بدلاً من `'done'`
- الكود يستخدم حالات جديدة: `'pending'`, `'on-hold'`, `'quality-check'`

## ✅ الحل

تم إنشاء migration script لتحديث CHECK constraint:

### الملف: `sql/migrations/33_update_manufacturing_orders_status_constraint.sql`

هذا الـ script:
1. يحذف الـ constraint القديم
2. ينشئ constraint جديد مع جميع الحالات:
   - `draft`
   - `pending`
   - `confirmed`
   - `in-progress` (الجديد)
   - `in_progress` (للتوافق مع القديم)
   - `quality-check`
   - `on-hold`
   - `completed` (الجديد)
   - `done` (للتوافق مع القديم)
   - `cancelled`

3. يحدث البيانات الموجودة:
   - `in_progress` → `in-progress`
   - `done` → `completed`

## 🚀 خطوات التنفيذ

1. **شغّل SQL Script:**
   ```sql
   -- في Supabase SQL Editor
   -- شغّل: sql/migrations/33_update_manufacturing_orders_status_constraint.sql
   ```

2. **تحقق من النتيجة:**
   ```sql
   -- تحقق من الـ constraint
   SELECT pg_get_constraintdef(oid)
   FROM pg_constraint
   WHERE conrelid = 'manufacturing_orders'::regclass
   AND conname = 'manufacturing_orders_status_check';
   ```

3. **تحقق من البيانات:**
   ```sql
   -- عرض توزيع الحالات
   SELECT status, COUNT(*) as count
   FROM manufacturing_orders
   GROUP BY status
   ORDER BY count DESC;
   ```

## ✅ النتيجة المتوقعة

- ✅ جميع الحالات الجديدة مدعومة
- ✅ البيانات الموجودة محدثة
- ✅ التوافق مع البيانات القديمة (`in_progress`, `done`)
- ✅ لا مزيد من أخطاء CHECK constraint

---

**Date:** [Date]  
**Status:** ✅ Ready to Execute

