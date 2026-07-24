# Migration 147 — Atomic UoM Purchase Order Creation

## الهدف

إضافة `rpc_create_uom_purchase_order(jsonb)` لإنشاء رأس أمر الشراء وجميع سطوره داخل معاملة PostgreSQL واحدة، مع التحقق من المؤسسة والمورد والصنف ووحدة الشراء القانونية.

## نطاق الأمان

- migration إضافية فقط؛ لا حذف ولا تعديل للتاريخ.
- لا ترسل أو تكتب العمود المولّد `purchase_order_lines.line_total`.
- تطبيع الكمية والسعر يبقى عبر trigger migration 139.
- إجماليات الرأس تُشتق بعد الإدخال من السطور المخزنة، لا من قيم الواجهة.
- أي فشل في أي سطر يلغي الرأس وكل السطور السابقة ضمن الاستدعاء نفسه.
- التنفيذ متاح لـ`authenticated` فقط، بعد `wardah_assert_org_member`.
- يتطلب تفعيل `uom_engine_enabled` للمؤسسة.

## التحقق قبل التطبيق

```sql
SELECT to_regprocedure('public.rpc_create_uom_purchase_order(jsonb)');
SELECT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgname = 'normalize_purchase_order_line_uom'
    AND NOT tgisinternal
);
```

قبل التطبيق يجب أن تكون الدالة غير موجودة، وأن يكون trigger التطبيع موجودًا.

## التحقق بعد التطبيق

```sql
SELECT to_regprocedure('public.rpc_create_uom_purchase_order(jsonb)');

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'rpc_create_uom_purchase_order'
ORDER BY grantee, privilege_type;
```

المتوقع:

- الدالة موجودة بتوقيع `jsonb`.
- `authenticated` لديه `EXECUTE`.
- لا يوجد `EXECUTE` لـ`anon` أو `PUBLIC`.

## اختبار القبول

```bash
psql -v ON_ERROR_STOP=1 -d wardah_fresh \
  -f scripts/ci/fresh-db/acceptance_147_atomic_uom_purchase_order.sql
```

يثبت الاختبار:

1. حفظ الكمية والسعر التجاريين مع Snapshot المعامل.
2. تطبيع 2 كرتون × 12 إلى 24 وحدة أساس، والسعر 120 إلى 10 للوحدة الأساسية.
3. اشتقاق إجمالي 276 من السطور المخزنة.
4. رفض وحدة مخصصة للبيع فقط في أمر شراء.
5. رفض مورد أو منتج من مؤسسة أخرى.
6. rollback كامل عند فشل السطر الثاني، دون رأس يتيم.

## Production

لا تُطبّق migration 147 على Production بمجرد نجاح PR. بعد الدمج:

1. راجع نجاح CI وFresh DB وبوابة القبول المخصصة.
2. طبّق migration بالاسم القانوني الكامل وبالترتيب.
3. نفّذ استعلامات التحقق أعلاه.
4. نفّذ Smoke Test في مؤسسة تجريبية مفعّل لديها المحرك.
5. تحقق من سجل `supabase_migrations.schema_migrations` وظهور migration مرة واحدة.
