# Migration 202 — إغلاق الكتابة المميّزة على أدلة الجودة (F1)

**الملف:** `sql/migrations/202_qc_privileged_write_closure.sql`
**القبول:** `docs/db/qc-privileged-write-closure-202/` (`red.sql` و`acceptance.sql` و`concurrency.py`
و`owner_switch_mechanics.sql` و`run_local.sh`) والـworkflow
`.github/workflows/qc-privileged-write-202-acceptance.yml`.
**المصدر:** تصحيح F1 المعرّف في `docs/db/qc-privileged-pause-199/` (#313): `service_role` يملك
`INSERT` على `quality_inspections` فيصنع دليل إفراج بلا RPC.
**الحالة:** مستودع فقط. **غير مطبّقة على Production ولا على Staging، ولا يُطلب تطبيقها هنا.**
تتطلب 190–201 في السجل الحي أولًا (٢٠١ شرط صريح بفحص preflight). لا تعني هذه الوثيقة أن
أي بيئة حية بلغت 202.

---

## 1) القرار

سياسة المالك الافتراضية المحافظة: **لا كتابة QC مباشرة من `service_role` ولا من أي اعتماد آخر.**
الكتابة الوحيدة عبر `rpc_record_quality_inspection`. لا يكفي أن تكون الدالة `SECURITY DEFINER`
أو مملوكة لـpostgres: أي دالة `SECURITY DEFINER` أخرى مملوكة لـpostgres ويصل إليها `service_role`
تعمل بهوية postgres نفسها (عدّ المراجع المستقل 110 دالة، منها 8 بـSQL ديناميكي).

| العنصر | القرار |
|---|---|
| الهوية | دور `wardah_qc_entry_202`: NOLOGIN بلا أي خاصية، بلا عضويات، **يملك دالة واحدة فقط**: `rpc_record_quality_inspection` |
| الكتابة | الـRPC (مملوكة للدور) تستدعي `wardah_internal.qc_prepare_inspection_202` (مملوكة لـpostgres؛ جسم M199 نفسه للتحقق والترقيم وidempotency دون كتابة فحص)، ثم تنفّذ الكتابة الوحيدة |
| الأصل | marker في `wardah_internal.qc_entry_markers_202`: `xid8` المعاملة الكاملة + `backend_pid` + الفحص/المؤسسة/الأمر/الطلب. يكتبه دور المدخل فقط ويحذفه قبل العودة؛ قيد مؤجل يفشل أي marker يبقى عند COMMIT. لا GUC |
| الحارس | `BEFORE INSERT` من نوع **SECURITY INVOKER** على `quality_inspections` وعلى رابط السلطة، `ENABLE ALWAYS`. يرفض ما لم يكن `current_user` دور المدخل، عمق trigger = 1، `session_replication_role = origin`، وmarker مطابق للصف، وكان `qc_assert_closed_graph_202()` ينجح |
| الإغلاق | `REVOKE ALL` من PUBLIC وanon وauthenticated وservice_role على الجدول (يزيل منح الأعمدة)، ويُقرأ الأثر الفعلي والموروث بـ`has_*_privilege` |

لا يوجد owner-only shortcut: المالك والـsuperuser يُرفضان بالحارس كذلك (ليسا دور المدخل).
الـSuperuser ومدير DDL **خارج** ما يضمنه حارس قاعدة بيانات؛ يبقى ذلك ضابطًا تشغيليًا.

## 2) عقد «الرسم التنفيذي المغلق» (`qc_assert_closed_graph_202`)

يُنفَّذ في الـpostflight وعند **كل** INSERT محروس. يرفع `QC_EXECUTION_GRAPH_OPEN_202: <سبب>`:

| السبب | ما يرفضه |
|---|---|
| `ROLE_ATTRIBUTES` / `ROLE_SETTINGS` | دور المدخل بخاصية (LOGIN، BYPASSRLS، CREATEROLE، SUPERUSER، …) أو إعدادات دور/قاعدة |
| `MEMBERSHIP` | أي عضوية تمنح SET/INHERIT على الدور، أو الدور عضو في غيره. المتسامَح فقط: صف ADMIN-only الذي يمنحه `CREATE ROLE` لمنشئ غير superuser إن كان مالك الجداول المحروسة (لا يُلغى، مثبت) |
| `OWNED_OBJECTS` | الدور يملك غير الـRPC في **قاعدة البيانات الحالية** (`pg_shdepend` على مستوى العنقود فيُقيَّد بـ`dbid`) |
| `ENTRY_ACL_SET` / `ENTRY_TABLE_PRIVILEGES` / `ENTRY_SCHEMA_PRIVILEGES` | أي منح للدور خارج قائمة السماح (جداول وأعمدة ودوال و default privileges وCREATE) أو امتيازات أوسع من المطلوب |
| `DIRECT_WRITE_PATH` | أي دور غير superuser وغير مالك الجدول يملك INSERT/UPDATE/DELETE/TRUNCATE (جدول أو عمود أو موروث أو PUBLIC) على المخازن الأربعة |
| `SESSION_REPLICATION_ROLE` | أي دور غير superuser يستطيع `SET session_replication_role` (يشمل `GRANT SET ON PARAMETER` والموروث) |
| `INSERT_TRIGGERS` / `MARKER_TRIGGERS` | أي trigger إضافي (يعمل بهوية المدخل) أو حارس غير `ENABLE ALWAYS` |
| `HIDDEN_ROUTINE` | دالة/عامل خارج `pg_catalog` في default أو CHECK أو فهرس لهذه الجداول |
| `POLICIES` | RLS معطّل أو سياسة INSERT غير سياسة دور المدخل |
| `FUNCTION_PIN` / `RPC_ACL` / `HELPER_ACL` | تغيّر جسم أو خصائص (`search_path`، DEFINER، مالك) الـRPC أو التحضير أو التقييم أو الحارس، أو ACL غير المتوقع |

بصمات `md5(prosrc)` الحالية (ثوابت داخل `qc_assert_closed_graph_202`):

| الدالة | البصمة |
|---|---|
| `public.rpc_record_quality_inspection` (مالكها دور المدخل) | `88503b798e33108c9a4a70fe4ae4078c` |
| `wardah_internal.qc_prepare_inspection_202` | `59c37bde0173f6236ad3db146ed1b27c` |
| `wardah_internal.evaluate_quality_release_199` | `fb8dd9fedf3cbf5da2cb26a17fd67eef` |
| `wardah_internal.qc_write_guard_202` | `87728ac9fe99afb1289af4e3ffd46d96` |

أي migration لاحقة تستبدل إحداها **يجب** أن تستبدل `qc_assert_closed_graph_202` بالبصمات الجديدة،
وإلا توقفت كتابة QC مغلقةً (وهذا مقصود). والـRPC نفسها تعيد التحقق من العضوية
(`wardah_assert_org_member`) للمؤسسة التي حلّها التحضير فلا تعتمد على المساعد وحده.

## 3) الاختيار NULL-safe والـsupersession append-only

- **الشرائح:** FINAL حسب (org, MO, QC cycle)، وIN_PROCESS حسب (org, MO, stage) دون تغيير نطاق M199
  (التقييم لكل مرحلة مستقل عن الـcycle).
- **الترتيب الموحد:** `inspection_seq DESC NULLS LAST, id DESC` داخل أدلة أحدث `authority_revision`.
  M199 كان `ORDER BY inspection_seq DESC` فتُرتَّب NULL أولًا (أُثبت RED: صف مزوّر بـNULL يحجب FAIL حقيقي).
- **`authority_revision`:** جدول خاص `quality_inspection_authority_202` يكتبه المدخل فقط. الصف بلا رابط
  = revision 0 (يشمل كل التاريخ السابق، دون backfill تخميني).
- **التجاوز:** `rpc_supersede_quality_evidence_202(mo, type, stage, expected_revision, reason)`
  (مسؤول المؤسسة فقط؛ مفتاح `manufacturing.settings.update` المفوَّض من M201 **لا** يفوّضها) يُلحق صفًا
  في `quality_supersessions_202` ويرفع revision الشريحة. لا يُعدَّل ولا يُحذف أي فحص. تبقى البوابة
  **مغلقة** حتى يُسجَّل فحص حقيقي جديد في الـrevision الجديد؛ الصفوف المزوّرة والحقيقية القديمة
  تبقى ظاهرة بـ`superseded=true` في `rpc_list_quality_inspections`.
- **فساد البيانات يرفض الإفراج:** رابط بمؤسسة أخرى أو revision لم تبلغه الشريحة ⇒ `QUALITY_AUTHORITY_CORRUPT`
  (لا يُقرأ كقرار أحدث).
- **حد معروف داخل الـrevision 0:** رقم تسلسل مرتفع مزوّر (999) يحجب فحصًا حقيقيًا لاحقًا حتى يُرفع الـrevision —
  هذا سبب وجود الآلية، وهو مثبت في القبول (D2) قبل التجاوز وبعده.
- **سلوك جديد صغير:** FINAL بلا صف `mo_quality_cycles` يُرفض `QUALITY_QC_CYCLE_MISSING` (كان M199 يكتب cycle فارغًا).
  مسار غير ممكن عادةً لأن الحالة `quality_check` تفتح الـcycle بـtrigger.

## 4) سلسلة الاستبدال (للـmigrations اللاحقة)

| الدالة | قبل 202 | بعد 202 |
|---|---|---|
| `rpc_record_quality_inspection` | M199 `499045298cf48632bd79325494307994` (مالك postgres) | `88503b79…` (مالك `wardah_qc_entry_202`، `search_path=''`) |
| `evaluate_quality_release_199` | M199 `f640dd1264b840d593d82bf53a49e181` | `fb8dd9fe…` |
| `rpc_list_quality_inspections` | M199 `159090c0b1f4e060cf218d026a0169c3` | `9cb343debbf7bd62b87a94926af5a8d8` |
| دوال M201 الخمس | بصمات ما بعد 201 (ثابتة) | **غير مستبدلة**؛ تُقارن بصمة وACL ومالك كلٍّ منها قبل/بعد في `run_local.sh` |

الـpreflight يثبّت بصمات M199 الثلاث وبصمات ما بعد 201 للخمس (`rpc_set_gl_event_mapping`
`68a55461…`، `rpc_set_material_issue_wo_statuses` `cd01220e…`، `rpc_set_quality_policy`
`782b3095…`، `rpc_get_quality_policy` `95347a01…`، `create_role_from_template` `d1d315ba…`)
ويرفض `M202_UNEXPECTED_M201_BODY` إن اختلفت، بما فيها إعادة تثبيت نص M199 السابق لـ201 (مُثبت).
لا يُبنى أي حارس هنا على أجسام ما قبل 201. `rpc_get_quality_policy` تُقرأ ولا تُستبدل: لا تلمس
`quality_inspections`.

## 5) داخل F1 وخارجه

**داخل F1 (migration 202):** إغلاق service_role، الحارس والأصل (marker)، الرسم المغلق، الاختيار NULL-safe،
supersession append-only، وتوثيق هذه السلسلة.

**خارج F1 — لم يُنفَّذ ولا يُدّعى:**
- سياج الإيقاف G05 (P01–P12) وإعادة ترميز مفتاح M171 (class 1463898705)؛ 202 لا تأخذ أي advisory lock جديد.
- جرد كتّاب service_role الآخرين. ملاحظة من هذا العمل: `rpc_set_material_issue_wo_statuses` و
  `create_role_from_template` ما زالتا تحملان `EXECUTE` لـ`service_role` قبل 202 وبعدها (محمية بـ`auth.uid()` والحراس)؛
  لم تُغيَّرا.
- مفتاح صلاحية مستقل للـsupersession (يتطلب تعديل `create_role_from_template`، وهي من دوال M201).
- سياسة المالك للتحقيق وللتاريخ المزوّر الحقيقي في أي بيئة حية؛ 202 توفّر الآلية لا القرار.
- الواجهة (`rpc_supersede_quality_evidence_202` غير مستهلكة بعد؛ الحقول الجديدة في القائمة إضافية).
- توليد Baseline يطوي 202 (انظر §6).

## 6) بوابات تشغيلية قبل أي تطبيق (لم يُصرَّح بأي تطبيق)

1. **منشئ غير superuser (Supabase `postgres`):** `owner_switch_mechanics.sql` يثبت آليًا أن تسلسل
   تبديل المالك ينجح بمالك مخطط NOSUPERUSER CREATEROLE على PG17 ويترك عضوية ADMIN-only فقط. **هذا ليس
   إثباتًا على Supabase المستضاف**؛ يلزم تدريب على Staging بعد إعادة بنائه (حالته UNVERIFIED).
   فشل أي خطوة يُجهض المعاملة كلها (فحص ذرية: لا دور ولا جداول ولا دوال ولا تغيير ACL).
2. **Baseline:** `pg_dump --no-owner` (كما تُولَّد اللقطات) يُسقط مالك الـRPC، فتفتح اللقطة التالية
   الرسم (`OWNED_OBJECTS`) فتُرفض كل كتابة QC مغلقةً، وتفشل منح الدور إن لم يُنشأ قبل اللقطة.
   لا يُولَّد Baseline يطوي 202 قبل تعديل المولّد/الشيم ليُنشئ الدور ويحفظ المالك، مع قبول Fresh DB.
3. **استعادة منطقية:** حارس `ENABLE ALWAYS` يُطلَق حتى مع `session_replication_role = replica`؛ تحميل بيانات
   `quality_inspections` بـCOPY عادي يُرفض. الاستعادة الفيزيائية/PITR سليمة؛ أي استعادة منطقية تحتاج
   إجراءً موثقًا بموافقة المالك (`DISABLE TRIGGER` صريح لهذا الجدول فقط ثم إعادة `ENABLE ALWAYS`).
4. **الدور على مستوى العنقود:** `CREATE ROLE` لا يتبع قاعدة بيانات؛ وجوده مسبقًا يوقف 202 (`M202_ALREADY_APPLIED`).
   فحوص `pg_shdepend` تُقيَّد بالقاعدة الحالية.
5. **Fail-closed على عنقود حي:** أي دور إضافي بمنح كتابة على المخازن الأربعة، أو دور يحمل منح SET على
   `session_replication_role`، يوقف كتابة QC بدل أن يُتجاهل. يُقاس ذلك في postflight التطبيق نفسه.
6. **TRUNCATE:** وجود FK من رابط السلطة إلى `quality_inspections` يجعل `TRUNCATE` العادي يفشل برسالة PostgreSQL
   قبل حارس M193؛ `TRUNCATE … CASCADE` ما زال يبلغ حارس M193 (مثبت).
7. **سلسلة Production المعلّقة:** 195–199 ثم 200 ثم 201 ثم 202. قراءة قراءة-فقط للسجل الحي مطلوبة قبل أي
   خطوة؛ لا يُفترض أي مستوى من وجود الملفات في `main`.

## 7) الأدلة المحلية (PostgreSQL 17.11، عنقود مؤقت)

`bash docs/db/qc-privileged-write-closure-202/run_local.sh` على baseline cutoff 189 + M190–M201:

| الفحص | النتيجة |
|---|---|
| RED قبل 202 | `M202_RED_REPRODUCED`: INSERT مباشر من service_role يفتح البوابة، NULL يحجب FAIL، 999 يحجبه ولا آلية تجاوز |
| ضوابط preflight/ذرية | 17 ضابطًا: بلا M201، انحراف كل من الدوال الخمس، نص M199 السابق لـ201 لدالتين، انحراف أجسام M199 الثلاثة، بلا USAGE على public، منح جدول لـauthenticated، trigger سابق يفتح الرسم (يُجهض كاملًا)، إعادة تطبيق، دور موجود |
| قبول 202 | 187 تأكيدًا + `M202_QC_PRIVILEGED_WRITE_CLOSURE_ACCEPTANCE_PASS`: سطح الامتيازات، المسار الحقيقي، التزوير (owner/same-owner/different-owner/marker/GUC/nested/replica)، 57 mutant كتالوجي مُلتقَط بسببه المحدد، و26 محاولة تزوير مرفوضة بسببها، و5 ضوابط non-vacuity (تعطيل الحارس أو إعادة المنح يجعل التزوير ينجح)، NULL والـsupersession (FINAL وIN_PROCESS ومرحلتان ودورتان وفساد)، عقد ما بعد 201 |
| دوال M201 الخمس | المالك والـACL والجسم متطابقة قبل/بعد 202 |
| انحدار M199 | 70/70 بنسخة معدَّلة بتغييرين موثقين في `run_local.sh` (توقّع `NOT_ORG_ADMIN` القديم بعد 201، وبذر صف legacy بإدخال مباشر يمنعه 202 عمدًا) |
| انحدار M200/M201 | `GL_EVENT_200_ACCEPTANCE_PASS` و`MFG_SETTINGS_201_ACCEPTANCE_PASS` و`CLAIMS_200_201_PASS` وعقد DEFINER الذاتي على سلسلة تحوي 202 |
| تزامن | 16 تسجيلًا متوازيًا، 10 متسابقين على طلب واحد، 12 جولة supersession مقابل تسجيل، سباق supersessions، marker لمعاملة أخرى |
| ثابتة | `check_migration_syntax.py` (pglast) و`check_definer_guards.py` نظيفان |

## 8) ما لم يُثبت

- لا Production ولا Staging ولا Supabase مستضاف؛ لا اعتماد حقيقي (JWT/هوية) ولا متصفح/واجهة.
- لا فحص لكل الأدوار في المشروع الحي (قد تفشل `DIRECT_WRITE_PATH` على دور لم نرَه).
- لا اختبار حمل مستدام، ولا تكلفة فحص الرسم لكل INSERT على بيانات حقيقية (فحوص كتالوج صغيرة).
- لم تُشغَّل مجموعات القبول الأخرى المبنية على السلسلة الكاملة (غير 199 و200 و201)، ولا الواجهة.
- المراجعة المستقلة لـ202 لم تحدث بعد.
