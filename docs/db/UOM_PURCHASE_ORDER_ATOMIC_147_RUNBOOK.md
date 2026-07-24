# Migration 147 — Selected-Org and Atomic UoM Purchase Orders

## الهدف

تضيف Migration 147 ثلاث دوال محروسة:

- `rpc_list_uom_purchase_order_options(uuid)` لتحميل الموردين والأصناف من المؤسسة المختارة صراحة.
- `rpc_get_purchase_product_uoms(uuid, uuid)` لتحميل وحدات الصنف ضمن المؤسسة المختارة.
- `rpc_create_uom_purchase_order(jsonb)` لإنشاء رأس أمر الشراء وجميع سطوره داخل معاملة PostgreSQL واحدة.

يعالج ذلك مستخدمي المؤسسات المتعددة دون الاعتماد على المؤسسة الافتراضية في JWT أو جلسة قاعدة البيانات، مع بقاء العضوية شرطًا إلزاميًا.

## نطاق الأمان

- Migration إضافية فقط؛ لا حذف ولا إعادة تفسير للتاريخ.
- كل دالة `SECURITY DEFINER` تثبت العضوية عبر `wardah_org_id(explicit)` ثم `wardah_assert_org_member`.
- التنفيذ متاح لـ`authenticated` فقط؛ لا `EXECUTE` لـ`anon` أو `PUBLIC`.
- تحميل خيارات النموذج وإنشاء المستند يتطلبان تفعيل `uom_engine_enabled` للمؤسسة.
- المورد والصنف والوحدة يجب أن تتبع المؤسسة الصريحة أو تكون الوحدة نظامية مشتركة.
- لا ترسل أو تكتب الدالة العمود المولّد `purchase_order_lines.line_total`.
- تطبيع الكمية والسعر يبقى عبر Trigger Migration 139.
- أي فشل في أي سطر يلغي الرأس وكل السطور السابقة ضمن الاستدعاء نفسه.

## سياسة التقريب المحاسبية

المبالغ تُقرب إلى خانتين على مستوى كل سطر، ثم تُجمع في الرأس:

- إجمالي السطر قبل الخصم: `round(quantity * unit_price, 2)`.
- صافي السطر بعد الخصم: `round(quantity * unit_price * (1 - discount/100), 2)`.
- إجمالي السطر شامل الضريبة هو `line_total` المولّد والمقرب إلى خانتين.
- خصم الرأس = مجموع إجمالي السطر قبل الخصم ناقص مجموع صافي السطر.
- ضريبة الرأس = مجموع `line_total` ناقص مجموع صافي السطر.

بهذا العقد تكون المعادلة التالية صحيحة دائمًا، حتى مع مئات السطور ذات كسور هللات:

```text
subtotal + tax_amount = total_amount
```

## التحقق قبل التطبيق

```sql
SELECT to_regprocedure('public.rpc_list_uom_purchase_order_options(uuid)');
SELECT to_regprocedure('public.rpc_get_purchase_product_uoms(uuid,uuid)');
SELECT to_regprocedure('public.rpc_create_uom_purchase_order(jsonb)');

SELECT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgname = 'normalize_purchase_order_line_uom'
    AND NOT tgisinternal
);
```

قبل التطبيق يجب أن تكون الدوال الثلاث غير موجودة، وأن يكون Trigger التطبيع موجودًا.

## التحقق بعد التطبيق

```sql
SELECT
  to_regprocedure('public.rpc_list_uom_purchase_order_options(uuid)') IS NOT NULL
  AND to_regprocedure('public.rpc_get_purchase_product_uoms(uuid,uuid)') IS NOT NULL
  AND to_regprocedure('public.rpc_create_uom_purchase_order(jsonb)') IS NOT NULL
  AS migration_147_functions_present;

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'rpc_list_uom_purchase_order_options',
    'rpc_get_purchase_product_uoms',
    'rpc_create_uom_purchase_order'
  )
ORDER BY routine_name, grantee, privilege_type;
```

المتوقع:

- الدوال الثلاث موجودة بالتواقيع المحددة.
- `authenticated` لديه `EXECUTE`.
- لا يوجد `EXECUTE` لـ`anon` أو `PUBLIC`.

## اختبار القبول

```bash
psql -v ON_ERROR_STOP=1 -d wardah_fresh \
  -f scripts/ci/fresh-db/acceptance_147_atomic_uom_purchase_order.sql
```

يثبت الاختبار:

1. مستخدم متعدد المؤسسات يستطيع تحميل خيارات المؤسسة الثانية صراحة دون الاعتماد على fallback الجلسة.
2. قراءة وحدات الصنف مقيدة بالمؤسسة المختارة، ويرفض الصنف من مؤسسة أخرى.
3. حفظ الكمية والسعر التجاريين مع Snapshot المعامل.
4. تطبيع 2 كرتون × 12 إلى 24 وحدة أساس، والسعر 120 إلى 10 للوحدة الأساسية.
5. اشتقاق إجمالي 276 من السطور المخزنة.
6. مستند من 500 سطر بسعر `1.0049` يبقى متزنًا: صافي 500، ضريبة 80، إجمالي 580.
7. رفض وحدة مخصصة للبيع فقط في أمر شراء.
8. رفض مورد أو منتج من مؤسسة أخرى حتى لو كان المتصل عضوًا في المؤسستين.
9. Rollback كامل عند فشل السطر الثاني، دون رأس يتيم.

## Production

لا تُطبّق Migration 147 على Production بمجرد نجاح PR. بعد الدمج فقط:

1. راجع نجاح CI وFresh DB وبوابة القبول المخصصة على أحدث SHA.
2. طبّق Migration بالاسم القانوني الكامل وبالترتيب.
3. نفّذ استعلامات التحقق أعلاه.
4. نفّذ Smoke Test في مؤسسة تجريبية مفعّل لديها المحرك، بما فيها مستخدم متعدد المؤسسات.
5. تحقق من سجل `supabase_migrations.schema_migrations` وظهور Migration مرة واحدة.
