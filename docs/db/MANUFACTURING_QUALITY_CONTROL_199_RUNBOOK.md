# Migration 199 — ضبط الجودة في التصنيع (قسم الضبط)

**الملف:** `sql/migrations/199_manufacturing_quality_control.sql`
**اسم التطبيق:** `199_manufacturing_quality_control`
**القبول:** `docs/db/quality-control-199/` +
`.github/workflows/quality-control-199-acceptance.yml`
**الأساس:** [جرد 2026-10-02](../architecture/MANUFACTURING_QUALITY_CONTROL_INVENTORY_20261002.md)
(الفجوات QC-01 … QC-14)

> **الحالة:** مدموجة في المستودع فقط بعد قبول الـPR. **غير مطبّقة** على Production
> أو Staging. لا يثبت وجود الملف أو نجاح CI أي تطبيق حي.

---

## 1) ماذا تضيف

| الطبقة | الإضافة |
|---|---|
| RBAC | ثلاثة مفاتيح بالبنية `module.resource.action`: `manufacturing.quality_inspections.read` و`.create` و`.approve_conditional` + قالبا دور «مراقب جودة» و«مدير الجودة» |
| إعدادات | `wardah_internal.quality_policies` صف لكل مؤسسة (يُبذر للمؤسسات الحالية وعبر trigger للجديدة) — **القيمة الافتراضية: البوابة مطفأة** |
| بيانات الفحص | أعمدة إضافية nullable على `quality_inspections`: `mo_id`, `stage_id`, `qc_cycle`, `inspection_seq`, `disposition`, `request_id`, `request_hash`؛ و`work_order_id` صار nullable (الجدول فارغ حيًا) |
| ثبات التاريخ | trigger يرفض `UPDATE` و`DELETE` على أي فحص مسجل حتى من المالك (`QUALITY_INSPECTION_IMMUTABLE`) — التصحيح فحص جديد |
| سطح الكتابة | سحب كل منح العميل (`anon`/`authenticated`) عن `quality_inspections`؛ الكتابة والقراءة عبر RPC فقط |
| بوابة الإفراج | trigger `zq_quality_release_gate_199` على `manufacturing_orders` عند الانتقال إلى `done` |
| دورات الفحص | `wardah_internal.mo_quality_cycles`: يزيد الرقم عند كل دخول إلى `quality_check`؛ الفحص النهائي يُفرج فقط عن دورته |
| RPCs | `rpc_get_quality_policy`, `rpc_set_quality_policy`, `rpc_record_quality_inspection`, `rpc_set_mo_quality_hold`, `rpc_list_quality_inspections`, `rpc_get_mo_quality_status` — كلها `authenticated` فقط |
| القوالب | `create_role_from_template` يستثني مفاتيح الجودة من التوسيع بالـwildcard (مثل `manufacturing.%` في قالب مدير الإنتاج) إلا إذا سمّاها القالب حرفيًا؛ بقية الجسم مطابق لـ196 |

## 2) أسئلة الجرد أصبحت إعدادات (Settings › الجودة)

| السؤال في الجرد (§6.1) | الإعداد | القيم | الافتراضي |
|---|---|---|---|
| 1. وحدة الفحص | `inspection_scope` | `final_only` فحص نهائي على الأمر · `stages_and_final` + فحص مرحلي ناجح لكل مرحلة لها WIP | `final_only` |
| 2. إلزامية البوابة | `release_gate_mode` | `off` · `all_orders` · `routing_flagged` (المسار فيه عملية `requires_inspection` أو نوع `INSPECTION`) | `off` |
| 3. قرارات الحسم | `allow_conditional_release` | قبول/خردة/إعادة تشغيل متاحة دائمًا؛ «القبول المشروط» (`use_as_is`) يحتاج هذا الإعداد **ومفتاح** `approve_conditional` | `false` |
| 4. محاسبة التالف | — | **غير مفعّل في 199.** الحسم يُسجَّل كبيانات فقط؛ لا ترحيل GL ولا حركة مخزون للمرفوض. تعيين `ABNORMAL_SCRAP` المبذور يحتاج مراجعة محاسبية أولًا (دائنه حساب الإنتاج التام) | — |
| 5أ. الفصل بين المهام | `segregation_of_duties` | من أنشأ الأمر أو كتب WIP مراحله أو صرف مواده أو شغّل أوامر عمله لا يفحصه | `true` |
| 5ب. هل يخضع المسؤول | `admins_subject_to_quality_controls` | `true`: منح صريح عبر دور نشط للجميع بمن فيهم Org Admin وSuper Admin، والفصل يسري عليهم · `false`: عقد `has_permission` المعتاد بتجاوز المسؤول، والفصل لا يسري على المسؤولين | `true` |

تغيير الإعدادات: `rpc_set_quality_policy` — مسؤول المؤسسة فقط، مع `expected_version`
(قفل تفاؤلي) وسجل في `audit_logs` (`manufacturing.quality_policy.update`).

## 3) عقد البوابة

عندما تكون البوابة مطلوبة للأمر، يرفض الانتقال إلى `done` من **أي مسار** (RPC الإتمام
المحجور حاليًا، أو منسّق #230 مستقبلًا، أو تحديث مباشر بصلاحية المالك) بأحد الأسباب:

| السبب | المعنى |
|---|---|
| `QUALITY_CHECK_STATUS_REQUIRED` | الأمر لا يخرج إلى `done` إلا من `quality_check` |
| `QUALITY_RELEASE_REQUIRED` | لا فحص `FINAL` في الدورة الحالية |
| `QUALITY_RELEASE_REJECTED` | آخر فحص نهائي في الدورة `FAIL` |
| `QUALITY_CONDITIONAL_RELEASE_DISABLED` | آخر فحص `CONDITIONAL` والإعداد مطفأ الآن |
| `QUALITY_STAGE_INSPECTION_REQUIRED` | نطاق `stages_and_final` ومرحلة بلا فحص مرحلي ناجح |
| `QUALITY_RELEASE_QUANTITY_EXCEEDED` | `completed_quantity` أكبر من المُفرَج (`PASS`: المقبول؛ `CONDITIONAL`: المقبول + المقبول كما هو) |

الرفض يُلغي المعاملة كاملة، فلا يدخل مخزون تام ولا قيد (مُثبت في القبول).

**الانتقالات المتاحة للجودة:** `rpc_set_mo_quality_hold` يتيح فقط
`in_progress → quality_check` (`hold`) و`quality_check → in_progress` (`return`، مع سبب
إلزامي)، بمفتاح `.create` وإصدار `maintenance_version` (196). هذا استثناء محدود ومراجَع
لحجر 195: لا يفتح الإتمام ولا أي انتقال آخر، والدخول إلى `quality_check` يجمّد الصرف
(192 لا يقبل الاستهلاك إلا في `in_progress`).

## 4) قواعد تسجيل الفحص (`rpc_record_quality_inspection`)

- `request_id` إلزامي: نفس الطلب ونفس المستخدم ⇒ إعادة الرد دون صف جديد؛ نفس المعرف
  بمحتوى مختلف ⇒ `QUALITY_REQUEST_ID_REUSED`.
- `inspector_id` و`qc_cycle` والرقم (`QI-000001` عدّاد لكل مؤسسة) يحددها الخادم.
- `FINAL` يتطلب `quality_check` وبلا مرحلة؛ `IN_PROCESS` يتطلب مرحلة من المؤسسة والأمر
  في `in_progress` أو `quality_check`.
- كمية مرفوضة > 0 ⇒ `disposition` إلزامي (`scrap`/`rework`، أو `use_as_is` مع
  `CONDITIONAL` فقط). `FAIL` و`CONDITIONAL` يتطلبان إجراءً تصحيحيًا.
- ترتيب الأقفال: صف الأمر ثم صف الإعدادات (مشترك) ثم العدّاد — يتسلسل مع الإتمام الذي
  يقفل صف الأمر أيضًا.

## 5) ترتيب التطبيق على Production (إلزامي)

1. **الشرط المسبق:** 195→196→197→198 مطبّقة بالترتيب ومتحقق منها. حزمتها حاليًا
   «Draft / NO-GO» ([الحزمة](material-issue-canonical-195-198/README.md))، و199 ترفض
   التطبيق قبلها (`M199_REQUIRES_M190_THROUGH_M198`).
2. ادمج PR الـMigration هذا إلى `main` (repository-first).
3. نفّذ فحص ما قبل التطبيق (§6) وطبّق `199_manufacturing_quality_control` مرة واحدة
   بالملف القانوني من `main`.
4. نفّذ القراءة بعد التطبيق (§6). يجب أن تبقى البوابة `off` لكل المؤسسات.
5. بعد ذلك فقط يُدمج PR الواجهة (صفحة الجودة وتبويب «الجودة» في الإعدادات) — DB-first.
6. تفعيل البوابة قرار تشغيلي للمؤسسة من الإعدادات، بعد إنشاء دور «مراقب جودة» وتعيينه.

## 6) استعلامات القراءة فقط

قبل التطبيق:

```sql
SELECT count(*) AS rows, count(DISTINCT (org_id, inspection_number)) AS distinct_numbers
FROM public.quality_inspections;                       -- يجب تساويهما
SELECT count(*) FROM public.manufacturing_orders WHERE status = 'quality_check';
SELECT has_table_privilege('authenticated','public.manufacturing_orders','UPDATE'); -- false (195)
```

بعد التطبيق:

```sql
SELECT count(*) FROM public.permissions WHERE resource = 'quality_inspections';     -- 3
SELECT count(*) FILTER (WHERE release_gate_mode <> 'off') AS gated,
       count(*) AS orgs FROM wardah_internal.quality_policies;                       -- gated = 0
SELECT (SELECT count(*) FROM public.organizations) =
       (SELECT count(*) FROM wardah_internal.quality_policies) AS all_orgs_seeded;   -- true
SELECT count(*) FROM wardah_internal.mo_quality_cycles;  -- = أوامر quality_check قبل التطبيق
SELECT has_table_privilege('authenticated','public.quality_inspections','SELECT')
    OR has_table_privilege('authenticated','public.quality_inspections','INSERT')
    OR has_table_privilege('anon','public.quality_inspections','INSERT') AS client_surface; -- false
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname IN ('zq_quality_release_gate_199','deny_quality_inspection_change_199',
                 'seed_quality_policy_199');                                         -- 3 × O
```

## 7) التراجع

لا تراجع هدّام. البوابة مطفأة افتراضيًا، فالـmigration لا تغيّر أي مسار إتمام حتى
تفعيلها. أي تعطيل لاحق يكون بإعادة الإعداد إلى `off` من الإعدادات (مدقَّق)، وأي تصحيح
بنيوي يكون migration لاحقة إضافية. لا تُحذف صفوف `quality_inspections` (محمية).

## 8) خارج النطاق (متابعات)

- ترحيل GL للتالف غير العادي ومراجعة تعيين `ABNORMAL_SCRAP` (QC-04).
- تمثيل الوحدات التالفة في معادلة `stage_wip_log` (QC-05).
- الفحص الوارد ومسار حسم `pending_inspection` ومخزن الحجر (QC-08/QC-09).
- كيان NCR/CAPA وتتبع الدفعات (QC-10/QC-11).
- منسّق الإتمام الطرفي #230 وصلاحيات MES في #154 (البوابة جاهزة له).

## 9) دليل القبول المحلي

`bash docs/db/quality-control-199/run_local.sh` على PostgreSQL 17.11، من Baseline cutoff
189 ثم 190→198:

- **RED (قبل 199):** لا مفتاح جودة؛ `anon`/`authenticated` يكتبان الفحوص؛ عضو قراءة
  فقط يسجل `PASS` بلا مفتش ثم يعيد كتابته؛ الأمر يخرج من `quality_check` إلى `done` بلا فحص.
- **GREEN (بعد 199):** 66 تأكيدًا تشمل: الصلاحيات وعزل المستأجر، والقفل التفاؤلي
  للإعدادات والأمر، وidempotency، والثبات حتى للمالك، والبوابة بكل أسبابها، ودورة
  إعادة التشغيل، والفصل بين المهام، والإفراج المشروط، ونطاق المراحل، وتراجع المخزون
  التام عند الرفض، واستثناء القوالب.
- **عقد DEFINER** على الكتالوج (مع selftest الطافرات الأربع) و`acceptance_reference_rbac`.
- **تزامن حقيقي بجلستين:** ترقيم متمايز، وطلب مكرر يُكتب مرة واحدة، وسباق `FAIL`
  ضد الإتمام يتسلسل دائمًا.
- مجموعات CI الأخرى على السلسلة الكاملة 190→199 بقيت خضراء محليًا: حجر 195 (72 probe +
  9 ضوابط أعمدة)، وثوابت 186 على السلسلة النهائية، وLedger Truth (enforced)، و144/145،
  والبيانات المرجعية.
