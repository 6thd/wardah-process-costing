# Runbook — Integrity Hardening Migrations 122–124

**التاريخ:** 2026-07-18  
**النطاق:** Supabase project `uutfztmqvajmsxnrqeiv`  
**قاعدة السلامة:** لا حذف جداول أو أعمدة أو بيانات. التطبيق متسلسل، والتحقق بعد كل migration.

## الحالة قبل التطبيق

وقت إعداد هذا الدليل:

- Production مطبقة حتى Migration 121.
- المستودع يحتوي Migration 122 لكنها غير مطبقة حيًا.
- `handle_new_user()` الحية تكتب إلى جدول النسخة التاريخية بدل `user_profiles`.
- `wardah_assert_org_member()` تعامل `is_active IS NULL` كعضوية نشطة.
- تسويات المخزون تُنفذ عبر عدة طلبات منفصلة ويمكن أن تترك Ledger/Products/GL غير متطابقة عند فشل جزئي.

## التغييرات

### Migration 122

تنظف fallback المؤسسة الافتراضية داخل `check_entry_approval_required()`، دون تغيير جداول أو بيانات.

### Migration 123

- تستبدل جسم `handle_new_user()` ليكتب إلى `public.user_profiles`.
- تبقي trigger `on_auth_user_created` كما هو.
- تستخدم upsert للحفاظ على الملف الحالي وتحديث الاسم والبريد فقط عند توفرهما.
- تجعل العضوية والإدارة مشروطتين بـ`is_active IS TRUE`.
- لا تحذف الجدول التاريخي ولا بياناته.

### Migration 124

- تضيف عمودين اختياريين على `stock_adjustments` لربط القيود القانونية في `gl_entries`، مع إبقاء حقول `journal_entries` التاريخية.
- تضيف outgoing stock helper مع FIFO/LIFO/Weighted Average.
- تضيف RPC ذري لإنشاء تسوية المخزون ورأسها وسطروها.
- تضيف RPC ذري لترحيل التسوية: Ledger + bins + products + GL + status.
- تضيف RPC ذري للإلغاء الدقيق.
- ترفض الإلغاء عند وجود حركة لاحقة على نفس المنتج/المخزن، بدل تنفيذ عكس غير موثوق.
- تضيف حركة مخزون يدوية قانونية عبر Ledger.
- تضيف استهلاك مواد محجوزة ذريًا مع تحديث الحجز والمخزون والـLedger.

## اختبارات ما قبل التطبيق

نفذ للقراءة فقط:

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 10;

SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure);
SELECT pg_get_functiondef('public.check_entry_approval_required(uuid)'::regprocedure);
SELECT pg_get_functiondef('public.wardah_assert_org_member(uuid)'::regprocedure);
SELECT pg_get_functiondef('public.wardah_is_org_admin(uuid)'::regprocedure);

SELECT count(*) FILTER (WHERE qual = 'true') AS using_true,
       count(*) FILTER (WHERE with_check = 'true') AS check_true
FROM pg_policies
WHERE schemaname = 'public';
```

سجل النتائج في تذكرة النشر أو تعليق PR.

## ترتيب التطبيق

التطبيق يجب أن يكون بالترتيب التالي فقط:

1. `122_fix_check_entry_approval_dead_code.sql`
2. `123_fix_user_profile_trigger_and_active_guards.sql`
3. `124_atomic_stock_adjustments_and_material_consumption.sql`

لا تشغل 124 قبل 123، لأن RPCs الجديدة تعتمد الحارس المشدد.

## اختبارات بعد Migration 122

```sql
SELECT pg_get_functiondef('public.check_entry_approval_required(uuid)'::regprocedure);
```

معيار النجاح: لا وجود لـ`app.current_org_id` ولا للمؤسسة الافتراضية داخل الدالة.

## اختبارات بعد Migration 123

```sql
SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure);
SELECT pg_get_functiondef('public.wardah_assert_org_member(uuid)'::regprocedure);
SELECT pg_get_functiondef('public.wardah_is_org_admin(uuid)'::regprocedure);

SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
```

معايير النجاح:

- `handle_new_user` تحتوي `public.user_profiles`.
- الحارسان يحتويان `is_active IS TRUE`.
- trigger `on_auth_user_created` ما زال موجودًا.

اختبار المستخدم الجديد يُنفذ بحساب اختبار فقط، ثم التأكد من وجود صف في `user_profiles`. لا تحذف مستخدمًا حقيقيًا.

## اختبارات بعد Migration 124

### وجود الكائنات

```sql
SELECT to_regprocedure('public.rpc_create_stock_adjustment(jsonb)');
SELECT to_regprocedure('public.rpc_submit_stock_adjustment(uuid)');
SELECT to_regprocedure('public.rpc_cancel_stock_adjustment(uuid,text)');
SELECT to_regprocedure('public.rpc_manual_stock_movement(uuid,numeric,text,uuid,text)');
SELECT to_regprocedure('public.rpc_consume_reserved_materials(uuid,jsonb)');
SELECT to_regprocedure('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)');
```

### الصلاحيات

```sql
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS public_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'rpc_create_stock_adjustment',
    'rpc_submit_stock_adjustment',
    'rpc_cancel_stock_adjustment',
    'rpc_manual_stock_movement',
    'rpc_consume_reserved_materials',
    'wardah_apply_stock_outgoing'
  )
ORDER BY p.proname;
```

المعيار:

- RPCs العامة: `authenticated=true`, `anon=false`, `PUBLIC=false`.
- helper الخارجي: غير متاح للعملاء.

### اختبار وظيفي آمن

نفذ داخل transaction مع بيانات اختبار موجودة ثم `ROLLBACK`:

```sql
BEGIN;
-- set_config/request.jwt.claims أو جلسة مستخدم اختبار حسب أسلوب الاختبارات الحالي.
-- أنشئ تسوية صغيرة عبر rpc_create_stock_adjustment.
-- رحّلها وتحقق من SLE/bin/product/gl_entries.
-- ألغها قبل أي حركة لاحقة وتحقق من استعادة القيم.
ROLLBACK;
```

معايير التسوية:

- إنشاء الرأس والسطور معًا أو لا شيء.
- الترحيل ينتج SLE ويطابق bin وproducts.
- القيد متوازن في `gl_entries/gl_entry_lines`.
- replay لا يكرر الحركة.
- الإلغاء ينشئ reversal SLE غير ملغى ويعيد الحالة السابقة.
- وجود حركة أحدث يؤدي إلى `LATER_STOCK_MOVEMENT_EXISTS` دون تغيير أي بيانات.

## مراقبة ما بعد النشر

```sql
SELECT status, count(*) FROM stock_adjustments GROUP BY status;

SELECT product_id, warehouse_id,
       max(posting_datetime) AS last_movement,
       sum(actual_qty) FILTER (WHERE NOT COALESCE(is_cancelled, false)) AS ledger_delta
FROM stock_ledger_entries
GROUP BY product_id, warehouse_id
ORDER BY last_movement DESC
LIMIT 50;

SELECT p.id, p.stock_quantity,
       COALESCE(sum(b.actual_qty), 0) AS bins_quantity,
       p.stock_quantity - COALESCE(sum(b.actual_qty), 0) AS difference
FROM products p
LEFT JOIN bins b ON b.product_id = p.id AND b.org_id = p.org_id
GROUP BY p.id, p.stock_quantity
HAVING abs(p.stock_quantity - COALESCE(sum(b.actual_qty), 0)) > 0.0001;
```

## الرجوع الآمن

لا يوجد rollback هدّام ضمن هذا التغيير. عند ظهور مشكلة:

1. أوقف استخدام الواجهة الجديدة عبر rollback للـfrontend deployment أو feature flag.
2. لا تحذف RPCs أو الأعمدة فورًا؛ وجودها لا يغير البيانات بذاته.
3. استبدل جسم الدالة المتأثرة بنسخة سابقة موثقة في Git دون حذف الكائن.
4. احتفظ بكل SLE وGL entries لأغراض التدقيق.
5. صحح البيانات فقط بسند تسوية/عكس قانوني، لا عبر `DELETE` أو تعديل تاريخي صامت.

## ما لا تفعله

- لا تعدّل `stock_quantity` مباشرة.
- لا تنشئ SLE ثم تحدّث Product في طلب منفصل.
- لا تعيد إدخال `SELECT *` من جدول يحتوي Generated Columns.
- لا تلغي تسوية بعد حركات لاحقة دون تحليل طبقات التقييم.
- لا تضع كلمة مرور قاعدة البيانات في commit أو log.
