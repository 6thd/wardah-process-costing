# Migration 200 — إغلاق الكتابة المباشرة على `gl_event_mappings` (MS-01)

**الملف:** `sql/migrations/200_gl_event_mapping_write_closure.sql`
**القبول:** `scripts/ci/fresh-db/acceptance_200_gl_event_mapping_write_closure.sql`
و`..._red.sql`، والـworkflow `.github/workflows/gl-event-mapping-200-acceptance.yml`.
**المصدر:** النتيجة MS-01 في `docs/architecture/MANUFACTURING_SETTINGS_INVENTORY_20261003.md` (PR #312).
**الحالة:** مستودع فقط. لا تُطبَّق قبل الدمج إلى `main` (repository-first).

---

## 1) المشكلة

`gl_event_mappings` يحدد الحسابات المدينة والدائنة لكل قيد قائم على حدث:
`MATERIAL_ISSUE` و`FG_RECEIPT` (إتمام أمر التصنيع)، و`OH_APPLIED` لكل مركز عمل،
وأحداث التالف وفروق الأعباء، و`COGS_DELIVERY`، و`GR_RECEIPT`، وأحداث المطابقة الثلاثية.
الكاتب الرسمي الوحيد `rpc_upsert_event_mapping` محصور في `service_role`، لكن الجدول نفسه
مفتوح:

- السياسة `gl_event_mappings_org_isolation` من نوع `FOR ALL`، بلا `TO` (فتنطبق على
  `PUBLIC`)، وتفحص `org_id = wardah_org_id()` فقط.
- `authenticated` و`anon` يملكان `GRANT ALL` على الجدول.

النتيجة: **أي عضو نشط** في المؤسسة يستطيع عبر PostgREST إدراج خريطة حسابات مؤسسته
أو تعديلها أو حذفها مباشرة، بلا فحص مسؤول ولا مفتاح صلاحية ولا سجل تدقيق. وبخلاف 185،
الثغرة ليست كامنة: السياسة المتساهلة موجودة فعلًا. يثبت ذلك اختبار red على Fresh DB حتى
199، إذ يعيد عضوٌ عاديٌّ توجيه `FG_RECEIPT` مباشرة.

## 2) التغيير

1. سحب `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` من `authenticated`
   (و`PUBLIC`)، وسحب كل الصلاحيات من `anon`. **يبقى `SELECT` لـ`authenticated`** لأن
   `fetchCogsAccounts` في `src/services/financial-statements-service.ts` يقرأ صفوف
   `COGS_DELIVERY` مباشرة لتقرير الربحية.
2. دالة جديدة `rpc_set_gl_event_mapping(p_org_id, p_event_code, p_debit_account_code,
   p_credit_account_code, p_work_center_code DEFAULT NULL, p_description DEFAULT NULL,
   p_is_active DEFAULT true)`:
   - `SECURITY DEFINER` بحارس `wardah_assert_org_admin(p_org_id)`، وEXECUTE لـ`authenticated` فقط.
   - تتحقق من صيغة رمز الحدث، وتقصر تجاوز مركز العمل على `OH_APPLIED` (القارئ الوحيد
     للصفوف الخاصة بالمركز هو `rpc_post_work_center_oh`)، وتتحقق من وجود المركز في المؤسسة.
   - تشترط أن يكون الحسابان مختلفين، وموجودين في شجرة حسابات **المؤسسة نفسها**،
     ونشطين، ويقبلان الترحيل.
   - تكتب upsert على المفتاح الفريد القائم `uq_gl_event_mappings_key`، وتسلسل كتّاب
     المفتاح الواحد بقفل advisory، وتكتب صفًا في `audit_logs` بالحالة قبل وبعد.

**لا يغيّر:** السياسة القائمة، و`rpc_upsert_event_mapping`، ودوال الترحيل القارئة، وأي صف
قائم، وصلاحيات `service_role`. ولا يزرع خرائط للمؤسسات الجديدة (MS-08 / القرار D2).

## 3) جرد المستهلكين

| المستهلك | النوع | الأثر بعد 200 |
|---|---|---|
| `fetchCogsAccounts` (تقرير الربحية) | `SELECT` من العميل | ✅ باقٍ |
| `rpc_post_event_journal`، `rpc_post_work_center_oh`، `rpc_create_matched_supplier_invoice_v149` | قراءة داخل الدالة | ✅ دون تغيير |
| `rpc_upsert_event_mapping` | كتابة (`service_role`) | ✅ دون تغيير |
| أي كتابة مباشرة من العميل | — | لا يوجد مستهلك في `src/` (تحقق `check-rbac-direct-writes`) |

## 4) شرط الترتيب على Production — مهم

Production حاليًا عند **194**؛ و195–199 مستودع فقط. **لا تُطبَّق 200 قبل 195–199.**
أداة السجل (`validate_migration_ledger.py`) تعتبر أعلى رقم مطبّق هو الـcutoff، و
`generate-baseline.yml` يبني الـBaseline التالي عليه. فتطبيق 200 أولًا يجعل 195–199 تبدو
مطوية في الـBaseline وهي لم تُطبَّق، فتُبنى كل Fresh DB بدونها بصمت.

إن أراد الفريق إغلاق MS-01 قبل 195–199، فذلك قرار صريح يحتاج حلًا موثقًا لترتيب السجل،
لا تطبيقًا خارج الترتيب.

## 5) قبل التطبيق (قراءة فقط)

```sql
-- يجب أن يُرجع صفًا واحدًا لكل من 190..199 قبل 200
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name ~ '^(19[0-9])_' ORDER BY version;

SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'gl_event_mappings'
  AND grantee IN ('anon','authenticated') GROUP BY 1;

SELECT count(*) AS mappings, count(DISTINCT org_id) AS orgs FROM public.gl_event_mappings;
```

## 6) بعد التطبيق (قراءة فقط)

```sql
SELECT has_table_privilege('authenticated','public.gl_event_mappings','SELECT') AS auth_select,   -- true
       has_table_privilege('authenticated','public.gl_event_mappings','UPDATE') AS auth_update,   -- false
       has_table_privilege('authenticated','public.gl_event_mappings','INSERT') AS auth_insert,   -- false
       has_table_privilege('anon','public.gl_event_mappings','SELECT')          AS anon_select,   -- false
       has_function_privilege('authenticated',
         'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)','EXECUTE') AS rpc_auth, -- true
       has_function_privilege('anon',
         'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)','EXECUTE') AS rpc_anon; -- false

-- لم يتغير أي صف
SELECT count(*) AS mappings, count(DISTINCT org_id) AS orgs FROM public.gl_event_mappings;

-- الاسم القانوني مرة واحدة في السجل
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '200_gl_event_mapping_write_closure';
```

الاختبار السلبي (محاولة كتابة كعضو عادي) مكانه Fresh DB أو بيئة معزولة، لا Production؛
وهو مغطى في اختبار القبول.

## 7) الأدلة المحلية قبل الـPR

على Fresh DB مبنية من Baseline cutoff 189 ثم 190–199 (PostgreSQL 16 محليًا مع نسخة
Baseline أزيلت منها عبارات PG17 فقط؛ CI يشغّلها على PostgreSQL 17):

- red (حتى 199): `GL_EVENT_200_RED_PROOF_OK` — عضو عادي أعاد توجيه `FG_RECEIPT` مباشرة.
- green (بعد 200): `GRANTS_OK`، و`MEMBER_PROBE_OK` (قراءة مسموحة، ورفض الكتابات المباشرة
  الثلاث بـ42501، ورفض الـRPC بـ`NOT_ORG_ADMIN`)، و`ADMIN_RPC_OK` (تحديث وإنشاء، ورفض سبعة
  مدخلات غير صالحة، وحدّ المؤسسة)، و`AUDIT_OK`.
- البوابات: صياغة pglast، وحارس DEFINER، وأسماء السجل، والترقيم (1–200)، وجرد طفرات RBAC،
  وبوابة الكتابة المباشرة — كلها ناجحة.
