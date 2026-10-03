# Migration 201 — صلاحية «إعدادات التصنيع» يمنحها مسؤول المؤسسة للأدوار

**الملف:** `sql/migrations/201_manufacturing_settings_permissions.sql`
**القبول:** `scripts/ci/fresh-db/acceptance_201_manufacturing_settings_permissions.sql`
و`..._red.sql`، والـworkflow `.github/workflows/manufacturing-settings-201-acceptance.yml`.
**المصدر:** قرارا المالك D1 وD3 على جرد إعدادات التصنيع (#312، §7)، والمرحلة 2 في §6.4.
**الحالة:** مستودع فقط. لا تُطبَّق قبل الدمج إلى `main` (repository-first)، ولا قبل 200.

---

## 1) القراران

- **D1:** إعدادات التصنيع داخل قسم الإعدادات العامة في `/settings/manufacturing`.
- **D3:** تعديلها صلاحية في قسم الصلاحيات، يمنحها مسؤول المؤسسة للأدوار حسب ما يحق لكل
  مستخدم. المسؤول نفسه يبقى قادرًا على التعديل كما اليوم.

## 2) المشكلة قبل 201

الكتّاب الثلاثة لإعدادات التصنيع تحرسهم `wardah_assert_org_admin` وحدها:

| الكاتب | Migration | ما يضبطه |
|---|---|---|
| `rpc_set_gl_event_mapping` | 200 | ربط القيود المحاسبية للأحداث |
| `rpc_set_material_issue_wo_statuses` | 192 | حالات أمر العمل المسموح بالصرف عليها |
| `rpc_set_quality_policy` | 199 | سياسة الجودة (القيم الخمس) |

فلا يوجد مفتاح يضعه المسؤول على دور، ولا طريقة لتفويض أي مستخدم غير مسؤول. اختبار red
يثبت ذلك: عضو عادي يحمل دورًا بكل مفاتيح `manufacturing.%` يُرفض من الثلاثة بـ`NOT_ORG_ADMIN`.

## 3) التغيير

1. **مفتاحان جديدان** في `permissions` تحت وحدة `manufacturing`:
   `manufacturing.settings.read` (عرض صفحة الإعدادات) و`manufacturing.settings.update`
   (التعديل). شاشة الأدوار `/org-admin/roles` تقرأ الكتالوج مباشرة (`rbac-service.ts`)، فيظهر
   المفتاحان فيها تلقائيًا ليمنحهما المسؤول. ليسا مفتاحين حساسين.
2. **لا توسيع بالـwildcard:** `create_role_from_template` (جسم 199 حرفيًا) يضيف المفتاحين إلى
   قائمة «يُمنح بالاسم الصريح فقط»، كمفاتيح الجودة في 199. قالب `manufacturing.%` لا يمنحهما.
3. **مُحدِّد واحد** `wardah_internal.manufacturing_settings_can_update_201(org)`:
   `is_super_admin() OR wardah_is_org_admin(org) OR has_permission(uid, org, 'manufacturing.settings.update')`.
   الكتّاب الثلاثة تستبدل `wardah_assert_org_admin` بـ`wardah_assert_org_member` ثم هذا المحدِّد،
   ويرفع الرفض `MANUFACTURING_SETTINGS_UPDATE_DENIED` بـSQLSTATE `42501`. و
   `rpc_get_quality_policy.capabilities.can_manage_policy` تُحسب من المحدِّد نفسه.

**لماذا لا `has_permission` وحدها؟** فرع تجاوز المسؤول فيها يقرأ `user_organizations.is_org_admin`
فقط، بينما `wardah_is_org_admin` (الحارس الحالي) يقبل أيضًا `role IN ('admin','owner')`. استخدامها
وحدها كان سيقفل التعديل أمام كل مسؤول معرَّف بالدور فقط. اكتشف القبول ذلك قبل الدمج، فصار
المحدِّد **مجموعة عليا صارمة** للحارس السابق: لا يفقد أي مسؤول حالي شيئًا.

**لا يغيّر:** ACL أي دالة (يُعاد فحصها في postflight)، ولا أي جسم آخر غير السطور المذكورة، ولا
`rpc_upsert_event_mapping`، ولا القراءة (`rpc_get_material_issue_wo_statuses` و`rpc_get_quality_policy`
تبقيان للأعضاء). مفتاح `manufacturing.settings.read` لا تقرؤه دالة في قاعدة البيانات؛ وظيفته بوابة
الصفحة في الواجهة.

## 4) العقد — سلسلة الاستبدال

201 تستبدل **خمس دوال** بـ`CREATE OR REPLACE`. أي استبدال لاحق لأي منها يجب أن يعيد تثبيت
طبقة 201 (أو يوثّق تغييرها صراحةً)، كسلاسل `has_permission` (170–173) و`rpc_get_trial_balance` (182–183):

| الدالة | الأجسام المتراكمة | طبقة 201 |
|---|---|---|
| `rpc_set_gl_event_mapping` | 200 (+ إصلاح الصورة السابقة الذري) | الحارس |
| `rpc_set_material_issue_wo_statuses` | 192 | الحارس |
| `rpc_set_quality_policy` | 199 | الحارس |
| `rpc_get_quality_policy` | 199 | `can_manage_policy` |
| `create_role_from_template` | 175 → 196 → 199 | المفتاحان في قائمة الاسم الصريح |

**حارس الـpreflight:** يرفض التطبيق إن لم يطابق الجسم الحالي لأي دالة النسخة التي نُسخ منها
(نص الحارس القديم وعلامات مميزة). فلا يمكن لـ201 أن تمحو بصمت استبدالًا لاحقًا.

**تنسيق مع #313 (سياج الإيقاف G05 المقترح):** وثيقة #313 تقترح تعديل
`rpc_set_quality_policy` و`rpc_set_material_issue_wo_statuses` و`create_role_from_template` أيضًا
(إضافة حاجز الإيقاف). أي الـmigrationين يُدمج ثانيًا **يحمل الطبقتين معًا**: إن جاء سياج الإيقاف
بعد 201 فيبقي استدعاء `manufacturing_settings_can_update_201`؛ وإن جاء قبلها فتفشل preflight 201
مغلقة ويُعاد نسخ الأجسام الجديدة.

## 5) ترتيب التطبيق على Production

`195 → 196 → 197 → 198 → 199` ثم `200` ثم `201`. 201 تعتمد على دوال 199 و200، وpreflight
يرفض التطبيق دونهما. والقاعدة نفسها كما في 200 (§4 من runbook 200): أعلى رقم مطبّق هو
cutoff الـBaseline التالي، فلا يُطبّق رقم قبل ما سبقه.

## 6) قبل التطبيق (قراءة فقط)

```sql
-- 199 و200 موجودتان مرة واحدة، و201 غير موجودة
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name ~ '^(199|200|201)_' ORDER BY version;

-- المفتاحان غير موجودين بعد
SELECT permission_key FROM public.permissions WHERE permission_key LIKE 'manufacturing.settings.%';

-- من يحرّر الإعدادات اليوم (مسؤولو المؤسسات)؛ للمقارنة بعد التطبيق
SELECT org_id, count(*) FILTER (WHERE is_org_admin) AS flag_admins,
       count(*) FILTER (WHERE role IN ('admin','owner')) AS role_admins
FROM public.user_organizations WHERE is_active GROUP BY org_id ORDER BY org_id;
```

## 7) بعد التطبيق (قراءة فقط)

```sql
SELECT p.permission_key, m.name AS module
FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
WHERE p.permission_key LIKE 'manufacturing.settings.%' ORDER BY 1;          -- صفّان، manufacturing

SELECT p.proname,
       position('manufacturing_settings_can_update_201(p_org_id)' IN pg_get_functiondef(p.oid)) > 0 AS new_guard,
       position('wardah_assert_org_admin' IN pg_get_functiondef(p.oid)) > 0 AS old_guard
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('rpc_set_gl_event_mapping','rpc_set_material_issue_wo_statuses','rpc_set_quality_policy');
-- new_guard = true و old_guard = false للثلاثة

SELECT has_function_privilege('authenticated',
         'wardah_internal.manufacturing_settings_can_update_201(uuid)', 'EXECUTE') AS helper_exposed;  -- false

SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '201_manufacturing_settings_permissions';                        -- صف واحد
```

اختبار السلوك (حامل المفتاح يحفظ، والعضو يُرفض، والمسؤولان بالدور وبالعلم يحفظان) مكانه Fresh DB أو
بيئة معزولة، لا Production؛ وهو مغطى في القبول.

## 8) الأدلة المحلية قبل الـPR

على Fresh DB من Baseline cutoff 189 ثم 190–199 ثم 200 (PostgreSQL 16 محليًا بنسخة Baseline
حُذفت منها عبارات PG17 فقط؛ CI على PostgreSQL 17):

- **red (حتى 200):** `MFG_SETTINGS_201_RED_PROOF_OK` — عضو يحمل كل مفاتيح التصنيع يُرفض من الثلاثة.
- **green (بعد 201):** `CATALOG_OK`، `MEMBER_DENIED_OK` (عضو بلا مفتاح يُرفض من الثلاثة بـ42501
  و`can_manage_policy=false`)، `KEYHOLDER_OK` (عضو غير مسؤول بالمفتاح يحفظ في الثلاثة)،
  `ADMIN_OK` (مسؤول بالدور فقط **و**مسؤول بالعلم فقط يحفظان — لا قفل)، `CROSS_ORG_OK`،
  `TEMPLATE_EXPANSION_OK` (قالب `manufacturing.%` لا يمنح المفتاحين، والاسم الصريح يمنحهما).
- **فرق الأجسام:** `pg_get_functiondef` قبل 201 وبعدها لكل دالة مستبدلة لا يُظهر إلا سطور الحارس
  و`can_manage_policy` وقائمة القالب.
- **إعادة التشغيل** ترفض بـ`MFG_SETTINGS_201_ALREADY_APPLIED`.
- **الحزم القائمة على السلسلة الكاملة مع 201:** قبول 200 (بعد قبوله رسالة الرفض الجديدة) وسباقه،
  و176، تنجح. حزمتا 175 و192 تفشلان **على السلسلة بدون 201 بالفشل نفسه** (175-M7 بسبب إغلاق
  176 للمنح؛ و192 لأن 195 غيّرت مسار إنشاء الأمر) — فشل سابق لا علاقة له بـ201، ولا يشغّلهما
  مسار هذا الـPR. قسم القوالب في 175 (الذي يمس `create_role_from_template`) ينجح قبل نقطة الفشل.
