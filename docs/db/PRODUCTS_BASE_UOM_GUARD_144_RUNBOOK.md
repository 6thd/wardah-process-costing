# Runbook — UoM master-data hardening (143–146)

**التاريخ:** 2026-07-23  
**الملفات:**
- `143_uom_engine_flag_org_scoped_read.sql`
- `144_products_base_uom_change_guard.sql`
- `145_uom_stock_write_guard.sql`
- `146_uom_master_data_hardening.sql`

**الحالة:** موجودة في PR #41، **غير مطبقة على Production**، وعلم
`uom_engine_enabled` ما زال مغلقًا افتراضيًا ولم يُفعّل ضمن هذا العمل.

## القرار المحاسبي والتقني

وحدة الأساس ليست حقل عرض؛ كل كميات SLE و`bins`، ومعاملات التحويل، وحقائق الوزن
الصافي والإجمالي تُفسَّر نسبةً إليها. لذلك يسمح هذا الإصدار بـ**التعيين الأول فقط**.
بعد وجود `base_uom_id` لا يجوز استبدالها بوحدة أخرى حتى لو لم توجد حركة مخزون؛
التغيير المستقبلي يحتاج RPC ترحيل ذرية مستقلة تُغلق التحويلات القديمة، وتطلب عوامل
وأوزانًا جديدة، وتسجل Audit Trail كاملًا.

## Migration 144 — التعيين والحل القانوني

### الحارس

`wardah_guard_products_base_uom_change()` يطبق الآتي:

- يستدعي `wardah_assert_org_admin(NEW.org_id)` على تحديث المستخدم؛ العضو العادي لا
  يستطيع تجاوز RPC بتحديث مباشر.
- يسمح فقط بالانتقال من `NULL` إلى وحدة أساس قانونية.
- يرفض أي استبدال لوحدة موجودة بـ
  `PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP`.
- يرفض التعيين المتأخر إذا وُجدت SLE لصنف ما زال بلا وحدة قانونية.
- يقبل وحدة نشطة مشتركة أو مملوكة للمؤسسة نفسها فقط، ويرفض
  `is_product_specific=true`.
- يضبط `uom_migration_status='MAPPED'` ذريًا ويغلق مشكلة المنتج المفتوحة.

### القيد المرحلي

`products_base_uom_mapping_invariant` يمنع الصفوف الجديدة أو المعدلة من ادعاء
`MAPPED` دون `base_uom_id`. يبقى القيد `NOT VALID` حتى لا يفشل النشر بسبب صف تاريخي
غير متسق؛ الصفوف التاريخية تظهر في شاشة الإصلاح ولا تُعدّل تلقائيًا. التحقق الكامل
`VALIDATE CONSTRAINT` يكون في migration مستقلة بعد اكتمال مواءمة كل المؤسسات.

### RPCs

- `rpc_assign_product_base_uom`: تعيين أول أو مصالحة idempotent لنفس الوحدة فقط.
- `rpc_resolve_uom_backfill_issue`: يستخرج وحدة الحل من المصدر الفعلي
  (`products` / `items` / `item_product_map` / `bom_lines`). أي وحدة مُمرَّرة يجب أن
  تطابق المصدر، والمصادر غير المدعومة تفشل مغلقة.
- `rpc_ignore_uom_backfill_issue`: يتطلب سببًا غير فارغ خادميًا.

جميع RPCs إدارية، `SECURITY DEFINER`، ذات `search_path` ثابت، ومسحوبة من
`PUBLIC` و`anon`.

## Migration 145 — حارس الكتابة المخزنية

`wardah_guard_mapped_product_uom_stock_write()` يطبق دائمًا سلامة المؤسسة:

- مؤسسة بند التسوية تطابق رأس التسوية.
- المخزن ينتمي إلى المؤسسة نفسها.
- لا يمكن صياغة صف Stock/SLE بهوية مؤسسة مختلفة.

وعندما يكون `uom_engine_enabled=true` يضيف:

- عضوية المتصل في المؤسسة.
- المنتج من المؤسسة نفسها وحالته `MAPPED`.
- وحدة أساس نشطة، غير خاصة بالصنف، ومشتركة أو مملوكة للمؤسسة.

يُعاد فحص كل `INSERT/UPDATE` لبنود التسوية حتى لا تمر مسودة أصبحت قديمة بعد
تغيير حالة الصنف أو تعطيل وحدته. SLE محمية عند الإدراج أو تغيير حقول الهوية، بينما
تحديثات الإلغاء التاريخية تبقى ممكنة.

## Migration 146 — الإغلاق النهائي

- يثبت حارس INSERT على `products` بصيغة آمنة: جلسة مستخدم تحتاج Org Admin، بينما
  Seed/Service-role بلا `auth.uid()` يبقى مسموحًا بشرط أن تكون الوحدة قانونية ونشطة
  ومشتركة أو مملوكة للمؤسسة وغير خاصة بالصنف.
- يعيد تثبيت حارس UPDATE الإداري ومنع استبدال وحدة أساس موجودة.
- يثبت إعادة فحص جميع تعديلات بنود التسوية.
- يحافظ على الطبيعة الإلحاقية لـSLE وعدم تعطيل إجراءات الإلغاء.

## التحقق قبل Production

```sql
-- 1) الترتيب القانوني للمigrations
SELECT version, name, applied_at
FROM public.schema_migrations
WHERE version BETWEEN 143 AND 146
ORDER BY version;

-- 2) الحراس النهائية الأربعة
SELECT c.relname AS table_name, t.tgname, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname IN (
  'trg_products_base_uom_insert_guard',
  'trg_products_base_uom_change_guard',
  'trg_stock_adjustment_items_require_mapped_uom',
  'trg_stock_ledger_entries_require_mapped_uom'
)
AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- 3) القيد المرحلي موجود وغير مُتحقق تاريخيًا بعد
SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'public.products'::regclass
  AND conname = 'products_base_uom_mapping_invariant';

-- 4) الصفوف التاريخية التي تحتاج معالجة قبل VALIDATE مستقبلي
SELECT id, org_id, code, base_uom_id, uom_migration_status
FROM public.products
WHERE uom_migration_status = 'MAPPED'
  AND base_uom_id IS NULL;
```

الاستعلام الثاني يجب أن يعيد أربعة صفوف مفعلة، والثالث يجب أن يعيد
`convalidated=false`. الاستعلام الرابع لا يوقف تطبيق 143–146، لكنه يجب أن يصبح صفرًا
قبل migration تحقق نهائية لاحقة.

## اختبارات القبول

- `acceptance_144_base_uom_guard.sql`: admin/member/nonmember، التعيين الأول، المصالحة
  لنفس الوحدة، منع إعادة التفسير، العزل، الوحدة الخاصة، والمطابقة الدقيقة لمصدر Backfill.
- `acceptance_145_uom_stock_write_guard.sql`: المنتج المهيأ/غير المهيأ، SLE،
  وسلوك العلم المغلق.
- `acceptance_146_uom_master_data_hardening.sql`: Seeds بلا JWT، منع العضو العادي،
  إعادة فحص مسودة قديمة، واستمرار إلغاء SLE التاريخية.

## ترتيب النشر لاحقًا

1. دمج PR بعد اخضرار جميع البوابات على رأس نهائي خالٍ من أدوات التصحيح المؤقتة.
2. أخذ نسخة احتياطية وفحص الاستعلامات أعلاه في Staging.
3. تطبيق migrations 143 ثم 144 ثم 145 ثم 146 عبر مسار النشر المعتمد.
4. تشغيل Acceptance/Smoke tests على Staging.
5. إبقاء `uom_engine_enabled=false`.
6. معالجة Backfill لكل مؤسسة.
7. تفعيل العلم لمؤسسة واحدة فقط بعد اعتماد منفصل ومراقبة النتائج.

## Rollback

لا تُعاد كتابة `base_uom_id` أو التحويلات لتجميل الحالة. عند ضرورة إيقاف الحراسة،
يكون ذلك عبر migration عكسية موثقة تسقط triggers فقط، مع إبقاء البيانات وسجل
المشكلات والتاريخ كما هو للتدقيق.
