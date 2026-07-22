# Runbook — Migration 144: `products_base_uom_change_guard`

**التاريخ:** 2026-07-22
**الملف:** `sql/migrations/144_products_base_uom_change_guard.sql`
**الحالة:** مدمجة في المستودع، **غير مطبقة على Production** ضمن هذا الـPR.
**التبعية:** تعتمد على كائنات محرك الوحدات 129–143 (خصوصًا `products.base_uom_id`،
`products.uom_migration_status`، `uom_backfill_issues`، `stock_ledger_entries`،
والحارسين `wardah_assert_org_admin` / `wardah_assert_org_member`).

## الغرض

استبدال الاعتماد على تعطيل زر الواجهة بحارس قاعدة بيانات fail-closed يمنع إعادة
تعريف وحدة الأساس بعد تسجيل أي حركة مخزنية، وتوفير المسار القانوني الوحيد لتعيين/إصلاح
وحدة الأساس وحل/تجاهل مشكلات المواءمة.

## ما تضيفه (additive فقط)

- **Trigger backstop:** `wardah_guard_products_base_uom_change()` على
  `BEFORE UPDATE OF base_uom_id ON public.products` — يرفض:
  - جعل وحدة خاصة بالصنف (`is_product_specific`) وحدةَ أساس.
  - أي تغيير لـ `base_uom_id` عند وجود صف في `stock_ledger_entries` للصنف/المؤسسة.
- **RPC قانونية (SECURITY DEFINER، admin-guarded، مسحوبة من PUBLIC/anon):**
  - `rpc_assign_product_base_uom(p_org_id, p_product_id, p_uom_id)` — تعيّن/تصلح وحدة
    الأساس عندما لا توجد حركات، تضبط الحالة `MAPPED`، وتغلق تلقائيًا مشكلة المواءمة
    المفتوحة للصنف.
  - `rpc_resolve_uom_backfill_issue(p_org_id, p_issue_id, p_resolved_uom_id, p_note)`.
  - `rpc_ignore_uom_backfill_issue(p_org_id, p_issue_id, p_note)`.

> لا يُحذف أو يُعدّل أي صف أو عمود أو migration قائم. `base_uom_id` المزروعة عبر 130 تبقى
> دون تغيير؛ الحارس يرفض **التغيير غير القانوني** فقط.

## خطوات التطبيق على Production (عند اعتمادها لاحقًا)

1. ابدأ من أحدث `main` بعد دمج هذا الـPR.
2. طبّق migration 144 بالاسم الكامل (stem الملف): `144_products_base_uom_change_guard`.
3. نفّذ استعلامات التحقق أدناه وتأكد من ظهور الاسم القانوني **مرة واحدة** في السجل.
4. لا تُفعّل `uom_engine_enabled` كأثر جانبي؛ التفعيل خطوة منفصلة لكل مؤسسة.

## استعلامات التحقق

```sql
-- 1) وجود الـtrigger على العمود الصحيح
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.products'::regclass
  AND tgname = 'trg_products_base_uom_change_guard';

-- 2) الدوال موجودة وSECURITY DEFINER
SELECT proname, prosecdef
FROM pg_proc
WHERE proname IN (
  'wardah_guard_products_base_uom_change',
  'rpc_assign_product_base_uom',
  'rpc_resolve_uom_backfill_issue',
  'rpc_ignore_uom_backfill_issue'
)
ORDER BY proname;

-- 3) EXECUTE مسحوبة من PUBLIC/anon على الـRPC
--    (يجب ألا يظهر anon/PUBLIC ضمن من يملك EXECUTE)
SELECT p.proname, r.rolname
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE p.proname = 'rpc_assign_product_base_uom'
  AND a.privilege_type = 'EXECUTE';
```

## اختبار سلبي/إيجابي موصى به (staging)

- محاولة `UPDATE products SET base_uom_id = ... WHERE id = <صنف له SLE>` مباشرة ⇒ يجب أن
  تفشل بـ `PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS`.
- استدعاء `rpc_assign_product_base_uom` لصنف بلا حركات كمدير ⇒ ينجح ويضبط `MAPPED` ويغلق
  مشكلة المواءمة؛ لغير المدير ⇒ يفشل عبر `wardah_assert_org_admin`.
- استدعاء `rpc_assign_product_base_uom` بوحدة `is_product_specific = true` ⇒ يفشل بـ
  `PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC`.

## العكس القانوني (rollback)

الترحيل additive: لإيقاف الحارس دون حذف تاريخ، استخدم
`DROP TRIGGER IF EXISTS trg_products_base_uom_change_guard ON public.products;` في migration
عكسية موثقة عند الحاجة. لا تُسقط `stock_ledger_entries` ولا تُعدّل `base_uom_id` تاريخيًا
لتجميل الحالة.
