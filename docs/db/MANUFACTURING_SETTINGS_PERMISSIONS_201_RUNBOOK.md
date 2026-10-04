# Migration 201 — صلاحية «إعدادات التصنيع» يمنحها مسؤول المؤسسة للأدوار

**الملف:** `sql/migrations/201_manufacturing_settings_permissions.sql`
**القبول:** `scripts/ci/fresh-db/acceptance_201_manufacturing_settings_permissions.sql`
و`..._red.sql`، والـworkflow `.github/workflows/manufacturing-settings-201-acceptance.yml`.
**المصدر:** قرارا المالك D1 وD3 على جرد إعدادات التصنيع (#312، §7)، والمرحلة 2 في §6.4.
**الحالة:** مستودع فقط. لا تُطبَّق قبل الدمج إلى `main` (repository-first)، ولا قبل 192 و199 و200.

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

البصمة هي `md5(pg_proc.prosrc)`، أي نص الجسم بين علامتي الـdollar quote. يُخزَّن حرفيًا ويعيده
`pg_dump` حرفيًا، فهو واحد في كل بيئة طبّقت الملفات القانونية، وفي أي Baseline لاحق يطويها. اشتُقت
البصمات أدناه من الملفات مباشرة، وطابقت قاعدة Fresh DB بايتًا ببايت.

| الدالة | الأجسام المتراكمة | طبقة 201 | البصمة قبل 201 (المصدر) | البصمة بعد 201 |
|---|---|---|---|---|
| `rpc_set_gl_event_mapping` | 200 (+ إصلاح الصورة السابقة الذري) | الحارس | `36e7f114c562c5de17fc24b9f5d6a7d7` (200) | `68a55461e73a5829728b45f430d4db59` |
| `rpc_set_material_issue_wo_statuses` | 192 | الحارس | `2025fc602029597fe97756c901485b33` (192) | `cd01220eab3266ce28744821825b0915` |
| `rpc_set_quality_policy` | 199 | الحارس | `23b60f4dfe97a0e690e630f42d6084ea` (199) | `782b30957175c20cfff71b6c9a3ee26d` |
| `rpc_get_quality_policy` | 199 | `can_manage_policy` | `a802945bb3fb0afa5e1b5d0af5219c20` (199) | `95347a01c938b4295d17e02e723b97ab` |
| `create_role_from_template` | 175 → 196 → 199 | المفتاحان في قائمة الاسم الصريح | `5cb026fc706caef1914dbf9a1aa5236b` (199) | `d1d315bab6f854a846624d79006b6008` |

**حارس الـpreflight — تطابق تام لا علامات:** يرفض التطبيق بـ`MFG_SETTINGS_201_UNEXPECTED_BODY` إن
اختلفت بصمة أي جسم حالي عن عمود «قبل 201»، أو تغيّر `SECURITY DEFINER` أو `search_path` (لأن
استبدال 201 يعيد تعريفهما). النسخة الأولى من 201 كانت تبحث عن علامات نصية داخل الأجسام، وهذا
**لم يكن كافيًا**: سياج يضيف أسطرًا ويُبقي كل سطر قديم كان يجتاز الفحص، ثم يمحوه استبدال 201.
أُثبت ذلك عمليًا (§8). **الـpostflight** يثبّت عمود «بعد 201» بالطريقة نفسها
(`MFG_SETTINGS_201_RESULT_BODY_MISMATCH`)، فيصير مرجعًا لأي migration لاحقة.

**تنسيق مع #313 (سياج الإيقاف G05 المقترح):** وثيقة #313 تقترح سياجًا يمس دوالًا تستبدلها 201
(`rpc_set_quality_policy` و`rpc_set_material_issue_wo_statuses` و`rpc_set_gl_event_mapping`
و`create_role_from_template`). أي الـmigrationين يُدمج ثانيًا **يحمل الطبقتين معًا**، والترتيبان
مثبتان آليًا في `scripts/ci/fresh-db/acceptance_201_layer_order.sh` بسياج محاكى (فحص إيقاف يُحقن
أعلى كل جسم دون حذف أي سطر):

| الترتيب | ما يحدث | ما يثبته الاختبار |
|---|---|---|
| السياج أولًا ثم 201 | preflight 201 ترفض مغلقة، فيُعاد اشتقاق 201 من الأجسام الجديدة | لكل دالة من الخمس: الرفض يسمّي الدالة، ولا يبقى أثر (لا مفاتيح)، والسياج سليم |
| 201 أولًا ثم السياج | migration السياج تتحقق من عمود «بعد 201» في preflight الخاصة بها، وتُبقي طبقة 201 | سياج يحفظ الطبقتين: قبول 201 كاملًا ينجح والسياج فعّال في الدوال الخمس |
| 201 أولًا ثم سياج منسوخ من جسم ما قبل 201 | الطبقة تسقط | لكل دالة من الخمس: قبول 201 يفشل (الكتّاب: رفض العضو؛ `rpc_get_quality_policy`: `can_manage_policy`؛ القالب: توسيع الـwildcard) |

workflow الـ201 يعمل على كل PR يمس `sql/migrations/**`، فأي migration سياج لاحقة تشغّل قبول 201
واختبار الترتيب على السلسلة الكاملة قبل الدمج.

## 5) ترتيب التطبيق على Production

`192` (مطبّقة على Production عند `20260928111141`) ثم `195 → 196 → 197 → 198 → 199` ثم `200`
ثم `201`. 201 تعتمد على جسم `rpc_set_material_issue_wo_statuses` من 192 وعلى دوال 199 و200، و
preflight يرفض التطبيق إن غاب أيٌّ منها أو اختلفت بصمته. وجود 192 في الـledger لا يكفي وحده؛
البصمة في §6 هي الإثبات. والقاعدة نفسها كما في 200 (§4 من runbook 200): أعلى رقم مطبّق هو
cutoff الـBaseline التالي، فلا يُطبّق رقم قبل ما سبقه.

## 6) قبل التطبيق (قراءة فقط)

```sql
-- 192 و199 و200 موجودة مرة واحدة لكلٍّ منها، و201 غير موجودة
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name ~ '^(192|199|200|201)_' ORDER BY version;

-- الأجسام الخمسة هي بالضبط ما تنسخه 201 (الصفوف الخمسة matches = true)
SELECT e.sig, md5(p.prosrc) = e.body_md5 AS matches, p.prosecdef, p.proconfig
FROM (VALUES
  ('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)', '36e7f114c562c5de17fc24b9f5d6a7d7'),
  ('public.rpc_set_material_issue_wo_statuses(uuid,text[])', '2025fc602029597fe97756c901485b33'),
  ('public.rpc_set_quality_policy(uuid,jsonb,bigint)', '23b60f4dfe97a0e690e630f42d6084ea'),
  ('public.rpc_get_quality_policy(uuid)', 'a802945bb3fb0afa5e1b5d0af5219c20'),
  ('public.create_role_from_template(uuid,uuid,character varying,uuid)', '5cb026fc706caef1914dbf9a1aa5236b')
) AS e(sig, body_md5)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
ORDER BY 1;

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

-- الأجسام الناتجة تطابق عمود «بعد 201» في §4 (الصفوف الخمسة matches = true)
SELECT e.sig, md5(p.prosrc) = e.body_md5 AS matches
FROM (VALUES
  ('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)', '68a55461e73a5829728b45f430d4db59'),
  ('public.rpc_set_material_issue_wo_statuses(uuid,text[])', 'cd01220eab3266ce28744821825b0915'),
  ('public.rpc_set_quality_policy(uuid,jsonb,bigint)', '782b30957175c20cfff71b6c9a3ee26d'),
  ('public.rpc_get_quality_policy(uuid)', '95347a01c938b4295d17e02e723b97ab'),
  ('public.create_role_from_template(uuid,uuid,character varying,uuid)', 'd1d315bab6f854a846624d79006b6008')
) AS e(sig, body_md5)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
ORDER BY 1;

SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '201_manufacturing_settings_permissions';                        -- صف واحد
```

اختبار السلوك (حامل المفتاح يحفظ، والعضو يُرفض، والمسؤولان بالدور وبالعلم يحفظان) مكانه Fresh DB أو
بيئة معزولة، لا Production؛ وهو مغطى في القبول.

## 8) الأدلة المحلية قبل الـPR

على Fresh DB من Baseline cutoff 189 ثم 190–199 ثم 200 (PostgreSQL 16 محليًا بنسخة Baseline
حُذفت منها عبارات PG17 فقط؛ CI على PostgreSQL 17، وهو المرجع):

- **red (حتى 200):** `MFG_SETTINGS_201_RED_PROOF_OK` — عضو يحمل كل مفاتيح التصنيع يُرفض من الثلاثة.
- **green (بعد 201):** `CATALOG_OK`، `MEMBER_DENIED_OK` (عضو بلا مفتاح يُرفض من الثلاثة بـ42501
  و`can_manage_policy=false`)، `KEYHOLDER_OK` (عضو غير مسؤول بالمفتاح يحفظ في الثلاثة)،
  `ADMIN_OK` (مسؤول بالدور فقط **و**مسؤول بالعلم فقط يحفظان — لا قفل)، `CROSS_ORG_OK`،
  `TEMPLATE_EXPANSION_OK` (قالب `manufacturing.%` لا يمنح المفتاحين، والاسم الصريح يمنحهما).
- **فرق الأجسام:** `pg_get_functiondef` قبل 201 وبعدها لكل دالة مستبدلة لا يُظهر إلا سطور الحارس
  و`can_manage_policy` وقائمة القالب.
- **إعادة التشغيل** ترفض بـ`MFG_SETTINGS_201_ALREADY_APPLIED`.
- **البصمات:** اشتُقت بصمات «قبل 201» و«بعد 201» من نصوص الملفات مباشرة، وطابقت `md5(prosrc)` في
  القاعدة للدوال الخمس.
- **ترتيب الطبقات** (`acceptance_201_layer_order.sh`): `FENCE_FIRST_OK` و`BOTH_LAYERS_OK`
  و`DROPPED_LAYER_CAUGHT_OK` و`PASS`، كما في جدول §4.
- **ضابط سلبي للنسخة الأولى:** سياج محاكى على `rpc_set_quality_policy`، ثم النسخة الأولى من 201
  (فحص العلامات). طُبّقت بنجاح **ومحت السياج**. هذا يؤكد ملاحظة المراجعة، ولهذا استُبدل فحص
  العلامات بالبصمة التامة.
- **الحزم القائمة على السلسلة الكاملة مع 201:** قبول 200 (بعد قبوله رسالة الرفض الجديدة) وسباقه،
  و176، تنجح. حزمتا 175 و192 تفشلان **على السلسلة بدون 201 بالفشل نفسه** (175-M7 بسبب إغلاق
  176 للمنح؛ و192 لأن 195 غيّرت مسار إنشاء الأمر) — فشل سابق لا علاقة له بـ201، ولا يشغّلهما
  مسار هذا الـPR. قسم القوالب في 175 (الذي يمس `create_role_from_template`) ينجح قبل نقطة الفشل.
