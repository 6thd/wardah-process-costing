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

## 8) العقد — `rpc_set_gl_event_mapping` وسطح `gl_event_mappings` بعد 200

هذا القسم هو المرجع لأي `CREATE OR REPLACE` لاحق على الدالة (مثل استبدال المرحلة 2 في
#312 §6.4) ولأي واجهة تستدعيها. أي استبدال **يجب أن يعيد تثبيت كل بند أدناه** أو يوثّق
تغييره صراحةً، تمامًا كسلاسل `has_permission` (170–173) و`rpc_get_trial_balance` (182–183).

### 8.1 التوقيع والصلاحيات

```sql
public.rpc_set_gl_event_mapping(
  p_org_id               uuid,
  p_event_code           text,
  p_debit_account_code   text,
  p_credit_account_code  text,
  p_work_center_code     text    DEFAULT NULL,
  p_description          text    DEFAULT NULL,
  p_is_active            boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
```

- `EXECUTE` لـ`authenticated` **فقط**. مسحوبة من `PUBLIC` و`anon` و`service_role` (الأخير
  لا يملك `auth.uid()` فيفشل الحارس أصلًا؛ مسار الخدمة القائم هو `rpc_upsert_event_mapping`).
- الجدول: `authenticated` يملك `SELECT` فقط؛ `anon` لا شيء؛ `service_role` كل الصلاحيات.
  السياسة `gl_event_mappings_org_isolation` (`FOR ALL`) باقية دون تغيير، وبعد سحب منح
  الكتابة لا تقبل إلا القراءة.

### 8.2 الحارس (أول جملة في الجسم)

`wardah_assert_org_admin(p_org_id)`، وترتيب فشله:
1. `NOT_AUTHENTICATED` — لا `auth.uid()`.
2. فشل العضوية النشطة في `p_org_id` (`wardah_assert_org_member`).
3. `NOT_ORG_ADMIN` — عضو نشط لكنه ليس `admin`/`owner`/`is_org_admin` ولا Super Admin.

لا يفحص مفتاح صلاحية. **قرار D3 في #312** يحدد هل يصبح الحارس `manufacturing.settings.update`
(مع تجاوز المسؤول أو بدونه)؛ حتى ذلك الحين الدالة لمسؤول المؤسسة فقط.

### 8.3 التحقق من المدخلات (بالترتيب، كلها SQLSTATE `22023`)

| # | الشرط | الخطأ |
|---|---|---|
| 1 | `upper(btrim(p_event_code))` يطابق `^[A-Z][A-Z0-9_]{1,63}$` | `GL_EVENT_MAPPING_INVALID_EVENT_CODE` |
| 2 | `p_is_active` ليس `NULL` | `GL_EVENT_MAPPING_IS_ACTIVE_REQUIRED` |
| 3 | مركز العمل (بعد `btrim`، والفارغ = `NULL`) مسموح فقط مع `OH_APPLIED` | `GL_EVENT_MAPPING_WORK_CENTER_OVERRIDE_NOT_SUPPORTED` |
| 4 | مركز العمل موجود في `work_centers` للمؤسسة نفسها (`code`) | `GL_EVENT_MAPPING_WORK_CENTER_NOT_FOUND` |
| 5 | الحسابان غير فارغين بعد `btrim` | `GL_EVENT_MAPPING_ACCOUNT_REQUIRED` |
| 6 | الحسابان مختلفان | `GL_EVENT_MAPPING_SAME_ACCOUNT` |
| 7 | المدين في `gl_accounts` للمؤسسة نفسها، `is_active IS TRUE`، `allow_posting IS NOT FALSE` | `GL_EVENT_MAPPING_DEBIT_ACCOUNT_INVALID` |
| 8 | الدائن بالشروط نفسها | `GL_EVENT_MAPPING_CREDIT_ACCOUNT_INVALID` |

**لا تتحقق** الدالة من أن رمز الحدث معروف لدى دالة ترحيل؛ أي رمز صحيح الصيغة يُقبل.
القائمة الحالية للقرّاء في §8.6.

### 8.4 الكتابة والتزامن

- قفل `pg_advisory_xact_lock(hashtextextended('wardah-gl-event-mapping:' || org || ':' || event || ':' || COALESCE(wc,''), 0))`
  ثم قراءة الصورة السابقة `FOR UPDATE`. يسلسل كتّاب المفتاح الواحد حتى عند الإدراج الأول.
- upsert على `uq_gl_event_mappings_key` = `(org_id, event_code, COALESCE(work_center_code, ''))`.
- عند التحديث: `debit_account_code` و`credit_account_code` و`is_active` تُستبدل،
  و`updated_at = now()`، و**`description = COALESCE(جديد, قديم)`** — أي أن تمرير `NULL` يُبقي
  الوصف القديم، **ولا توجد طريقة لمسح الوصف** عبر الدالة.
- **لا حذف:** لا يملك العميل `DELETE`؛ التعطيل `p_is_active = false` هو بديل الحذف.

### 8.5 التدقيق والقيمة المعادة

صف واحد في `audit_logs` لكل استدعاء ناجح:
`action = 'accounting.gl_event_mapping.set'`، `entity_type = 'gl_event_mapping'`،
`entity_id = id::text`، `user_id = auth.uid()`،
`old_data` = `NULL` عند الإنشاء وإلا `{event_code, work_center_code, debit_account_code, credit_account_code, is_active}`،
`new_data` بالمفاتيح نفسها، `metadata = {"source": "rpc_set_gl_event_mapping", "migration": 200}`.
الوصف غير مسجَّل في التدقيق.

القيمة المعادة (`jsonb`):
`{id, org_id, event_code, work_center_code, debit_account_code, credit_account_code, is_active, created}`
حيث `created = true` عند الإدراج الأول للمفتاح.

### 8.6 القرّاء الذين يعتمدون على الجدول (لا يتغيرون في 200)

| القارئ | الأحداث | ماذا يحدث إذا عُطّلت الخريطة أو غابت |
|---|---|---|
| `rpc_post_event_journal` (Baseline:8490) | أي حدث، صف `work_center_code IS NULL AND is_active` | يرفض صراحةً `MAPPING_MISSING` (fail-closed) |
| `rpc_post_work_center_oh` (Baseline:9472–9479) | `OH_APPLIED`: صف المركز أولًا، ثم الصف العام | تعطيل صف المركز يرجع إلى العام؛ غياب الاثنين `MAPPING_MISSING` |
| `rpc_create_matched_supplier_invoice_v149` (Baseline:6568–6590) | `AP_MATCHED_INVOICE_GOODS` و`AP_MATCHED_INVOICE_VAT` | `AP_ACCOUNT_MAPPING_MISSING`؛ و**يشترط تطابق الحساب الدائن** للحدثين وإلا `AP_ACCOUNT_MAPPING_INCONSISTENT` |
| `fetchCogsAccounts` (`financial-statements-service.ts:124`، عميل) | `COGS_DELIVERY` مع `is_active = true` | يعيد قائمة فارغة فيظهر COGS صفرًا في تقرير الربحية |

دوال الترحيل تحوّل الكود إلى معرّف بـ`SELECT id FROM gl_accounts WHERE org_id AND code` **دون**
فحص `is_active`؛ فتحقق الدالة من نشاط الحساب يحدث **وقت الضبط فقط**.

### 8.7 ثوابت لا يجوز كسرها في أي استبدال لاحق

1. لا منح `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` على الجدول لـ`authenticated` أو `anon` أو `PUBLIC`.
2. `SELECT` لـ`authenticated` باقٍ ما دام `fetchCogsAccounts` يقرأ الجدول مباشرة.
3. الحارس أول جملة في الجسم، قبل أي قراءة أو كتابة.
4. الحسابان من شجرة **المؤسسة نفسها** (`org_id = p_org_id`)، لا من أي مؤسسة.
5. صف تدقيق في المعاملة نفسها لكل تغيير.
6. `rpc_upsert_event_mapping` يبقى لـ`service_role` فقط.

---

## 9) ملاحظات مسجّلة للمراحل اللاحقة

سُجّلت قبل قرار الدمج حتى لا تضيع؛ لا يغيّر أي منها سلوك 200.

1. **ترتيب التطبيق:** بعد 195–199 فقط (§4). إن تأخرت 195–199 وأراد الفريق إغلاق MS-01 أولًا،
   فذلك قرار سجل موثق، لا تطبيق خارج الترتيب.
2. **الحارس مؤقت:** الدالة لمسؤول المؤسسة فقط. المرحلة 2 في #312 (§6.3–§6.4) تستبدلها مع
   `rpc_set_material_issue_wo_statuses` و`rpc_set_quality_policy` لتفحص
   `manufacturing.settings.update` وفق D3، أو تبقى تبويباتها لمسؤول المؤسسة صراحةً.
3. **كاتب ثانٍ قائم:** `rpc_upsert_event_mapping` (`service_role`) يتحقق من وجود الحسابين فقط
   (لا النشاط ولا قابلية الترحيل ولا الاختلاف)، ويفرض `is_active = true` عند التحديث، ولا يكتب
   تدقيقًا، ويحدد المؤسسة بـ`wardah_org_id(p_tenant)`. لم يُمسّ عمدًا (مسار البذر/التشغيل). أي تغيير له قرار مستقل.
4. **ثغرة اتساق AP لم تُغلق:** الدالة لا تمنع ضبط دائنين مختلفين لـ`AP_MATCHED_INVOICE_GOODS`
   و`AP_MATCHED_INVOICE_VAT`. النتيجة ليست قيدًا خاطئًا بل رفض صريح وقت إنشاء فاتورة المورد
   المطابقة (`AP_ACCOUNT_MAPPING_INCONSISTENT`). المعالجة المقترحة (لاحقًا): تحقق متقاطع في
   الدالة أو تحذير في الواجهة.
5. **لا تحقق من الحدث المعروف:** أي رمز صحيح الصيغة يُقبل، فقد تُنشأ صفوف لا يقرؤها أحد.
   الواجهة يجب أن تعرض قائمة أحداث مغلقة (§8.6)، أو تضيف المرحلة 2 قائمة مسموحة.
6. **نشاط الحساب يُفحص وقت الضبط فقط:** تعطيل حساب لاحقًا لا يعطّل الخريطة، ودوال الترحيل
   لا تفحص `is_active` للحساب. تبويب «الحالة» المقترح في #312 يجب أن يعرض الخرائط التي تشير
   إلى حسابات معطلة.
7. **التغيير مستقبلي فقط:** تعديل الخريطة لا يمس القيود المرحّلة سابقًا. تصحيح قيود تاريخية
   يتم بعكس قانوني موثق، لا بتعديل الخريطة.
8. **لا مسح للوصف:** `p_description = NULL` يُبقي القديم. إن احتاجت الواجهة المسح، يلزم معامل
   صريح في استبدال لاحق.
9. **MS-08 لم يُعالج:** لا زرع خرائط للمؤسسات الجديدة (قرار D2).
10. **الواجهة لاحقًا (DB-first):** لا واجهة تستدعي الدالة في هذا الـPR. تبويب «ربط القيود
    المحاسبية» لا يُدمج قبل تطبيق 200 على Production والتحقق منه (§6).
11. **CI — إنذارات Sonar `plsql:S1192` (10):** تكرار حرفيات في SQL، وبوابة الجودة ناجحة. تُركت
    كما في 199 (#309، 53 إنذارًا) و195–198 (#299، 100+) لأن الثوابت تضعف قراءة الـmigration.
12. **CI — commit الأنواع الآلي:** workflow `Regenerate UoM Database Types` يدفع تحديث
    `src/types/database.generated.ts` تلقائيًا، فتتوقف كل workflows على ذلك الـcommit في
    `action_required` حتى يضغط مالك المستودع «Approve and run workflows». متوقع لكل migration
    تضيف RPC.
13. **التحقق المحلي** جرى على PostgreSQL 16 بنسخة Baseline محلية حُذفت منها عبارات PG17 فقط؛
    الحكم النهائي لـCI على PostgreSQL 17 (ناجح على `80391b6` و`59decd9`).
