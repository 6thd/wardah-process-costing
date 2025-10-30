# 🔧 تعليمات تنفيذ إصلاح Tenant ID

## ⚠️ مهم جداً - اقرأ قبل التنفيذ

تم اكتشاف أن:
1. ❌ **قاعدة البيانات فارغة تماماً!**
2. ❌ جميع الجداول غير موجودة (organizations, gl_accounts, إلخ)
3. ✅ يجب تنفيذ البنية الكاملة أولاً

---

## 🚨 الحل السريع

### المشكلة:
قاعدة البيانات لا تحتوي على أي جداول!

### الحل:
يجب تنفيذ السكريبت الأساسي الكامل أولاً

---

## 📋 الخطوات الصحيحة بالترتيب

### الخطوة 0: عمل Backup (اختياري - القاعدة فارغة)

إذا كانت هناك بيانات مهمة:

1. في Supabase Dashboard
2. اذهب إلى Settings > Database
3. اضغط "Start a Backup"

---

### الخطوة 1: إنشاء البنية الأساسية الكاملة ⭐ **الأهم**

**نفذ السكريبت:** `supabase-setup.sql` (الموجود في المجلد الرئيسي)

```sql
-- افتح ملف: supabase-setup.sql من المجلد الرئيسي
-- انسخ المحتوى كاملاً (607 سطر)
-- والصقه في Supabase SQL Editor
-- اضغط Run
```

**ما يفعله:**
- ✅ ينشئ جميع الجداول الأساسية (30+ جدول)
- ✅ organizations, user_organizations
- ✅ gl_accounts (دليل الحسابات)
- ✅ products, warehouses, locations
- ✅ manufacturing_orders, stage_costs
- ✅ bom_headers, bom_lines
- ✅ stock_quants, stock_moves
- ✅ جميع الجداول المطلوبة للنظام

**الوقت المتوقع:** 2-3 دقائق

**النتيجة المتوقعة:**
```
✅ تم إنشاء جميع الجداول بنجاح
✅ تم تفعيل RLS
✅ تم إنشاء الـ Policies
```

---

### الخطوة 2: استيراد بيانات دليل الحسابات

بعد إنشاء الجداول، تحتاج لاستيراد البيانات:

**الخيار 1: استيراد من ملف SQL موجود**

ابحث عن ملف يحتوي على بيانات `gl_accounts`:
```sql
-- ابحث عن ملفات مثل:
-- - wardah_coa_insert.sql
-- - insert_gl_accounts.sql
-- - initial_data.sql
```

**الخيار 2: إنشاء منظمة يدوياً**

```sql
-- إنشاء منظمة افتراضية
INSERT INTO organizations (id, name, code, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Wardah Factory',
  'WF-001',
  true
);
```

---

### الخطوة 3: ربط المستخدمين بالمنظمة (إن وجدوا)

**نفذ السكريبت:** `01_fix_tenant_id.sql`

```sql
-- انسخ محتوى sql/urgent_fixes/01_fix_tenant_id.sql
-- والصقه في Supabase SQL Editor
```

**⚠️ ملاحظة:** نفذ هذا فقط إذا كانت لديك بيانات موجودة تحتاج إصلاح

**ما يفعله:**
1. ✅ يتحقق من وجود منظمة افتراضية (ينشئها إن لم تكن موجودة)
2. ✅ يربط جميع السجلات بـ org_id الافتراضي
3. ✅ يربط جميع المستخدمين بالمنظمة
4. ✅ يحدث جميع الجداول (gl_accounts, manufacturing_orders, products, إلخ)

**النتيجة المتوقعة:**
```
╔══════════════════════════════════════════╗
║     Summary Report - Wardah Factory     ║
╠══════════════════════════════════════════╣
║  GL Accounts: 190                        ║
║  Manufacturing Orders: X                 ║
║  Products: X                             ║
║  Purchase Orders: X                      ║
║  Sales Orders: X                         ║
║  User Associations: X                    ║
╚══════════════════════════════════════════╝

✅ تم إصلاح مشكلة Tenant ID بنجاح!
✅ جميع البيانات مرتبطة بالمنظمة الافتراضية
✅ جميع المستخدمين مرتبطون بالمنظمة
📊 يمكنك الآن اختبار النظام
```

---

### الخطوة 4: تنفيذ Materialized Path (لحل Stack Depth)

**نفذ السكريبت:** `02_implement_materialized_path.sql`

```sql
-- انسخ محتوى sql/urgent_fixes/02_implement_materialized_path.sql
-- والصقه في Supabase SQL Editor
```

**ما يفعله:**
- ✅ يفعّل ltree extension
- ✅ يضيف عمود path لدليل الحسابات
- ✅ يملأ path لجميع الحسابات
- ✅ يحل مشكلة Stack Depth

**النتيجة المتوقعة:**
```
╔════════════════════════════════════════╗
║  ✅ تم تطبيق Materialized Path بنجاح  ║
╠════════════════════════════════════════╣
║  إجمالي الحسابات: 190                 ║
║  الحسابات مع path: 190                 ║
║  نسبة الاكتمال: 100%                   ║
╚════════════════════════════════════════╝
```

---

## 🐛 استكشاف الأخطاء المحتملة

### الخطأ: "relation does not exist"

**السبب:** قاعدة البيانات فارغة، لم يتم إنشاء الجداول بعد

**الحل:**
```sql
-- تحقق من الجداول الموجودة
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- إذا كانت النتيجة فارغة أو لا تحتوي على gl_accounts
-- نفذ supabase-setup.sql أولاً (من المجلد الرئيسي)
```

---

### الخطأ: "duplicate key value violates unique constraint"

**السبب:** المنظمة أو البيانات موجودة مسبقاً

**الحل:**
```sql
-- تحقق من المنظمات الموجودة
SELECT * FROM organizations;

-- إذا وجدت منظمة، استخدم id الموجود
-- بدلاً من '00000000-0000-0000-0000-000000000001'
```

---

### الخطأ: "column does not exist"

**السبب:** اسم العمود مختلف

**الحل:**
```sql
-- تحقق من أعمدة gl_accounts
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- ابحث عن: org_id أو tenant_id
```

---

### الخطأ: "null value violates constraint"

**السبب:** البيانات تحتوي على NULL

**الحل:**
```sql
-- تحقق من القيم NULL
SELECT 
  COUNT(*) FILTER (WHERE org_id IS NULL) as null_count,
  COUNT(*) as total
FROM gl_accounts;

-- إذا وجدت NULL، السكريبت سيصلحها
```

---

### الخطأ: "ltree extension not available"

**السبب:** ltree غير مفعّل

**الحل:**
```sql
-- فعّل ltree
CREATE EXTENSION IF NOT EXISTS ltree;

-- تحقق
SELECT * FROM pg_extension WHERE extname = 'ltree';
```

---

## ✅ التحقق من النجاح

بعد تنفيذ جميع السكريبتات، نفذ هذا:

```sql
-- 1. تحقق من المنظمة
SELECT * FROM organizations 
WHERE id = '00000000-0000-0000-0000-000000000001';

-- يجب أن ترى: Wardah Factory

-- 2. تحقق من الحسابات
SELECT 
  COUNT(*) as total_accounts,
  COUNT(*) FILTER (WHERE org_id IS NOT NULL) as with_org,
  COUNT(*) FILTER (WHERE path IS NOT NULL) as with_path
FROM gl_accounts;

-- يجب أن يكون الكل متساوي: 190 = 190 = 190

-- 3. تحقق من المستخدمين
SELECT 
  u.email,
  uo.role,
  o.name
FROM auth.users u
LEFT JOIN user_organizations uo ON u.id = uo.user_id
LEFT JOIN organizations o ON uo.org_id = o.id;

-- يجب أن ترى جميع المستخدمين مرتبطين بـ Wardah Factory
```

---

## 🎯 الخلاصة

**ترتيب التنفيذ الصحيح:**
1. ✅ Backup قاعدة البيانات (اختياري - القاعدة فارغة)
2. ✅ `supabase-setup.sql` (المجلد الرئيسي) - **إلزامي!**
3. ⚠️ استيراد بيانات دليل الحسابات (إن وجدت)
4. ⚠️ `01_fix_tenant_id.sql` (فقط إذا كانت هناك بيانات تحتاج إصلاح)
5. ✅ `02_implement_materialized_path.sql` (لحل Stack Depth)

**الوقت المتوقع:** 10-15 دقيقة

**المخاطر:** منخفضة جداً (القاعدة فارغة)

---

## 📞 إذا واجهت مشاكل

1. **لا تكمل** إذا ظهرت أخطاء
2. **اعمل ROLLBACK** إذا كان السكريبت في transaction:
   ```sql
   ROLLBACK;
   ```
3. **راجع الخطأ** في Messages/Errors
4. **استعد Backup** إذا لزم الأمر
5. **اطلب المساعدة** مع نسخ رسالة الخطأ كاملة

---

**تم التحديث:** 28 أكتوبر 2025  
**الحالة:** ✅ جاهز للتنفيذ

حظاً موفقاً! 🚀
