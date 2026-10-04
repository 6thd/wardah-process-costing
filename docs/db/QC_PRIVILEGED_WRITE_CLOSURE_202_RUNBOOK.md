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
| `COLUMN_TYPE` | عمود (أو عنصر مصفوفة) بنوع DOMAIN أو مركّب — الـCHECK الخاص بالـdomain دالة تُستدعى عند كل INSERT بهوية من ينفّذه، بالآلية نفسها التي يغلقها هذا الـmigration في §أ1 أدناه، لكن عبر `ALTER TABLE ... ALTER COLUMN TYPE` لا cast غير مؤهَّل |
| `OPERATOR_CLASS` | فهرس على المخازن الأربعة يستخدم operator class خارج `pg_catalog` — دوال الدعم تُستدعى أثناء الفحص/التفرّد لا الـexpression فقط |
| `REWRITE_RULE` | أي `CREATE RULE` على المخازن الأربعة؛ القاعدة تُنفَّذ بديلًا عن أو إضافة للعبارة الأصلية ولا يغطيها جرد section 7 للـtriggers |
| `INHERITANCE` | أحد المخازن الأربعة أصبح له أصل أو فرع في `pg_inherits`، أو `relkind` ليست `r` (partitioned/غيرها) — الفرع (inheritance عادي أو partition) لا يرث triggers/RLS/grants الأصل تلقائيًا، فكتابة مباشرة إليه تتجاوز كل حارس أعلاه بينما يراها المقيّم عبر الأصل |
| `POLICIES` | RLS معطّل، أو سياسة INSERT/ALL غير سياسة دور المدخل، أو سياسة دور المدخل بغير شكلها المثبّت تمامًا: `PERMISSIVE`، `FOR INSERT`، `TO wardah_qc_entry_202` فقط، `polqual IS NULL`، و`pg_get_expr(polwithcheck) = 'true'` حرفيًا. أي `WITH CHECK` يستدعي دالة (مثلًا دالة SECURITY INVOKER بمالك مختلف) أو يغيّر الصياغة (`true AND true`) أو يعيد توجيه السياسة إلى PUBLIC/`service_role` أو يحوّلها RESTRICTIVE/FOR ALL أو يعيد تسميتها، يُرفض بالاسم داخل الحارس `BEFORE INSERT` — قبل وصول الصف إلى تقييم RLS، فلا تُنفَّذ دالة المسند أصلًا (مثبت بحارس-تسلسل غير معاملي، §7) |
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

### 2أ) تصحيح `search_path`: ثغرة عبور `pg_temp`، والسلسلة العابرة عبر `auth.uid()`

اكتُشف أثناء المراجعة أن `search_path = ''` (الذي استُخدم أصلًا في كل دوال 202 الجديدة) **لا يكفي**:
PostgreSQL يبحث `pg_temp` قبل `pg_catalog` لاسم نوع غير مؤهَّل ما لم يُذكر `pg_temp` صريحًا في القائمة —
وأي عضو مصادق عليه (غير مسؤول) يستطيع إنشاء `CREATE DOMAIN pg_temp.uuid AS pg_catalog.uuid CHECK (...)`
فتُستدعى دالة الـCHECK هذه عند أي `::uuid` غير مؤهَّل، بهوية الدالة المُستدعية (`current_user`) لا هوية
العميل. أُثبت هذا حيًا (PostgreSQL 17.11، domain بلا أي كتابة مزوَّرة، الـCHECK يرفع NOTICE فقط):

- **الصياغة الصحيحة إلزامية:** `SET search_path = pg_catalog, pg_temp` (قائمة غير مقتبسة، عنصران).
  كتابتها بين علامتي اقتباس واحدة `SET search_path = 'pg_catalog, pg_temp'` **ليست** معادلة؛ تُخزَّن
  اسم schema واحدًا مشوَّهًا، و`current_schemas(true)` يُرجع `{pg_temp_N, pg_catalog}` — `pg_temp` أولًا،
  فتنفَّذ الثغرة رغم الشكل الصحيح ظاهريًا. أُثبت الفرق بقراءة `current_setting('search_path')` و
  `current_schemas(true)` من داخل كل صياغة، لا بالاستنتاج.
- **الصياغة الموجودة أصلًا `public, pg_temp`** (في `rpc_list_quality_inspections` وغيرها) **سليمة**: يُدرَج
  `pg_catalog` ضمنيًا قبل أي عنصر غير مذكور في القائمة، فيسبق `pg_temp` المذكور صريحًا في آخرها.
- **الأشكال المتأثرة:** تعيين متغير (`v := expr::type`)، cast داخل `INSERT ... VALUES`، وDECLARE لمتغير
  بنوع غير مؤهَّل — يُحسم عند **أول استدعاء للدالة في الجلسة** (فلا يخفيه cache خطة جلسة أقدم). `RETURN
  expr::type` المطابق لنوع العودة المُعلَن للدالة نفسها **لم يتكرّر** (PL/pgSQL يُجبر النوع المعروف
  مباشرة). يشمل التأثر `regclass` و`regprocedure` و`regnamespace` و`oid`، لا `uuid`/`numeric`/`text` فقط.
- **السلسلة العابرة — لا يكفي فحص الجسم وحده:** `auth.uid()` (شيم Supabase المحلي: `LANGUAGE sql` بلا
  `SET` خاصة، جسمها `...::uuid`) يرث search_path **المُستدعي** عند كل استدعاء. فحص جسم
  `wardah_assert_org_member` (بلا cast) أو `quality_actor_can_199` (بلا cast) ظاهريًا سليم، لكن كلتيهما
  تستدعيان `auth.uid()` مباشرة، وكلتاهما كانت `search_path='public'`/`''` (لا `pg_temp` في موضع آمن)،
  فأُعيد إنتاج الثغرة عبرهما بـ`current_user=postgres` (أُثبت بـ`PG_CONTEXT` مُفصَّلًا، لا بالعدّ). **لا
  تُلمس** `auth.uid()` أو أي كائن في مخطط `auth` هنا؛ الشيم المحلي بديل غير مُتحقَّق منه لتنفيذ Supabase
  المستضاف، ويُبلَغ عنه فقط من خلال المستدعين.

**التصحيح — `ALTER FUNCTION ... SET search_path`، تعديل بيانات وصفية فقط، لا `CREATE OR REPLACE`،
ولا ملف M199/M198 قانوني يُلمس — يثبّت section 0 من الملف جسم كل دالة (`md5(prosrc)`) قبل التغيير
ويتحقق postflight أنه لم يتغيّر:**

| الدالة | كانت | أصبحت | السبب |
|---|---|---|---|
| 8 دوال 202 الجديدة (`deny_qc_history_change_202`، `qc_marker_orphan_check_202`، `qc_assert_closed_graph_202`، `qc_write_guard_202`، `evaluate_quality_release_199`، `qc_prepare_inspection_202`، `rpc_record_quality_inspection`، `rpc_supersede_quality_evidence_202`) | `''` | `pg_catalog, pg_temp` | الكتابة الوحيدة والمقيّم |
| `wardah_internal.mo_quality_gate_199()` / `mo_quality_insert_199()` (M199، لم يُلمس ملفها) | `''` | `pg_catalog, pg_temp` | trigger على **أي** انتقال حالة MO إلى/من `quality_check`، يصل إليه `hold`/`return` العادي بلا صلاحية مسؤول |
| `public.wardah_assert_org_member(uuid)` | `public` | `public, pg_temp` | تستدعي `auth.uid()`؛ حارس عضوية مستدعى من كل مسار QC |
| `public.wardah_is_org_admin(uuid)` | `public` | `public, pg_temp` | تستدعي `auth.uid()`؛ تصل إليها `quality_is_admin_199` (مستدعاة من `qc_prepare_inspection_202` حين `admins_subject_to_quality_controls=false`، ومن `rpc_supersede_quality_evidence_202` دائمًا) |
| `wardah_internal.quality_actor_can_199(uuid,text,boolean)` (M199) | `''` | `pg_catalog, pg_temp` | تستدعي `auth.uid()` مباشرة كوسيط لمساعدين آخرين |
| `trg_mo_status_machine()` / `public.validate_mo_transition(text,text)` (أقدم من M199، تسبقانه بكثير) | `public` | `public, pg_temp` | يُطلقهما أي انتقال حالة MO عادي، DECLARE `TEXT` خام؛ تصحيح بيانات وصفية ضيق لا تغيير قاعدة انتقال |

**لم يُلمس لعدم وجود cast أو استدعاء `auth.uid()` في جسمها مباشرة (تحقَّق من كل مسار استدعاء فعليًا لا
بالقراءة فقط):** `quality_has_explicit_grant_199`، `quality_is_production_participant_199` (تستلمان
الفاعل معاملًا جاهزًا)، `quality_is_admin_199` نفسها (تفويض فقط؛ مستدعياها المصحَّحان كافيان)، `has_permission`
و`is_super_admin` (كلتاهما `public, pg_temp` سليمة أصلًا).

**حدود صريحة غير مُغلقة:** أي دالة أخرى بصياغة غير آمنة يصل إليها عضو عادي خارج المسارات المفحوصة فعليًا
أعلاه — بما فيها نظائر محتملة في M196 وغيرها — **لم تُجرَد ولم تُثبَت**؛ لا يُدَّعى إغلاق أمني شامل.

**القبول:** `docs/db/qc-privileged-write-closure-202/type_shadow_regression.sh` (مُدار من
`run_local.sh`): جلسة جديدة تمامًا، domain حساس بلا أي كتابة، مسارا الـRPC والـhold معًا — صفر إصابة
بهوية مميّزة على البناء الصحيح (GREEN)، وإصابة مؤكدة بعد عكس تصحيح واحد عمدًا (RED، non-vacuity)، ثم
صفر بعد الاستعادة.

## 3) الاختيار NULL-safe والـsupersession append-only

- **الشرائح:** FINAL حسب (org, MO, QC cycle)، وIN_PROCESS حسب (org, MO, stage) دون تغيير نطاق M199
  (التقييم لكل مرحلة مستقل عن الـcycle).
- **الترتيب الموحد (البوابة):** `inspection_seq DESC NULLS LAST, id DESC` داخل أدلة أحدث `authority_revision`.
  M199 كان `ORDER BY inspection_seq DESC` فتُرتَّب NULL أولًا (أُثبت RED: صف مزوّر بـNULL يحجب FAIL حقيقي).
- **ترتيب القائمة (`rpc_list_quality_inspections`) مُحاذى للبوابة:** داخل كل شريحة (FINAL حسب `qc_cycle`،
  IN_PROCESS حسب المرحلة بلا فلتر cycle — كتعريف البوابة؛ والبوابة تقرأ cycle الـMO الحالي غير الفارغ فقط)
  `authority_revision DESC, inspection_seq DESC NULLS LAST, id DESC`. **انحراف مقصود عن صياغة `NULLS LAST` على
  الـrevision:** الصف بلا رابط سلطة يُعامَل revision 0 (`COALESCE(…,0)`) كما تفعل البوابة تمامًا، فصف NULL-authority
  وصف مرتبط بـrevision 0 يتنافسان بالتسلسل ثم الـid كما في البوابة؛ ترتيب `NULLS LAST` الحرفي كان سيعرض في الرأس
  صفًا غير الذي تختاره البوابة عند revision 0. أما الصف القديم NULL-authority بتسلسل مرتفع عشوائي فيأتي **بعد**
  أي دليل حقيقي عند revision أعلى (مثبت D2). الشرائح نفسها تُسرد بترتيب تسلسل رأس كلٍّ منها (الأحدث أولًا)،
  وصفوف الشريحة متجاورة. الصف الأول في كل شريحة هو الصف الذي تختاره البوابة (مثبت) **للبيانات السليمة ولـcycle الحالي فقط** — انظر ملحق §8: مع رابط سلطة فاسد أو cycle قديم/فارغ تختلف القائمة عن البوابة.
- **حالة الشريحة في القائمة (نتائج تشغيل فعلية في §8):** لكل صف الآن `partition_revision` (أحدث revision لتجاوز الشريحة)،
  `awaiting_replacement`، و`authority_status` ∈ {`CURRENT`، `SUPERSEDED`، `SUPERSEDED_AWAITING_REPLACEMENT`}.
  حين لا يوجد فحص حقيقي عند أحدث revision (بعد تجاوز بلا بديل) تحمل **كل** صفوف الشريحة
  `SUPERSEDED_AWAITING_REPLACEMENT`، والبوابة تبقى مغلقة (`QUALITY_RELEASE_REQUIRED`/`QUALITY_STAGE_INSPECTION_REQUIRED`) **لشريحة الـcycle الحالي**؛ شريحة cycle سابق بالحالة نفسها لا تغلق بوابة الـcycle الحالي.
  الحقول القديمة (`authority_revision`، `superseded`) بلا تغيير في المعنى.
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
| `rpc_record_quality_inspection` | M199 `499045298cf48632bd79325494307994` (مالك postgres) | `88503b79…` (مالك `wardah_qc_entry_202`، `search_path=pg_catalog, pg_temp` — انظر §2أ) |
| `evaluate_quality_release_199` | M199 `f640dd1264b840d593d82bf53a49e181` | `fb8dd9fe…` |
| `rpc_list_quality_inspections` | M199 `159090c0b1f4e060cf218d026a0169c3` | `bb2432f528a97ebb7f4d75a3e5b2f585` (كانت `9cb343de…` في الرأس السابق `7c4841ae`، قبل محاذاة الترتيب وحالة الشريحة) |
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
3. **استعادة منطقية:** `ENABLE ALWAYS` موجود على **كلا** الجدولين المحروسين بـguard القائمة
   السوداء — `public.quality_inspections` **و** `wardah_internal.quality_inspection_authority_202` —
   ويُطلَق حتى مع `session_replication_role = replica`؛ تحميل بيانات بـCOPY أو INSERT عادي في أيٍّ
   منهما يُرفض (`QC_WRITE_PROVENANCE_REQUIRED_202`)، حتى بهوية `postgres` نفسها. **الإجراء الكامل
   المُثبَت فعليًا** (عنقود مؤقت PG17.11، لا بيانات حقيقية):

   ```sql
   BEGIN;
   ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202;
   ALTER TABLE wardah_internal.quality_inspection_authority_202 DISABLE TRIGGER qc_write_guard_202;
   -- استرجاع الصفوف التاريخية في كلا الجدولين هنا (ما تفعله أداة الاستعادة)
   ALTER TABLE public.quality_inspections ENABLE ALWAYS TRIGGER qc_write_guard_202;
   ALTER TABLE wardah_internal.quality_inspection_authority_202 ENABLE ALWAYS TRIGGER qc_write_guard_202;
   COMMIT;
   ```

   **لا** `DISABLE TRIGGER` شامل (ALL)؛ الاسم محدد فيبقى حارس التغيير التاريخي (`deny_qc_history_change_202`)
   وحارس TRUNCATE (`deny_history_truncate_202`/`deny_history_truncate_193`) فعّالين طوال الإجراء، ولا
   يلزم تعطيلهما لاسترجاع INSERT-only. أُثبت حيًا: الصفوف استُرجعت في كلا الجدولين، الرابط الأجنبي بين
   `quality_inspection_authority_202` و`quality_inspections` سليم بعد ذلك، والحارس يرفض إدخالًا غير
   مصرَّح به جديدًا فور `ENABLE ALWAYS` (إعادة التسليح تعمل)، وبقيت الـtriggers الأخرى `ENABLED` طوال
   الإجراء. أثر هذا الإجراء على المالك والـACL **قيس الآن** بقراءة بصمة قبل/بعد على عنقود مؤقت
   (`history_rehearsal*.sql`، §7: «بروفة تحميل التاريخ INSERT-only»): البصمة متطابقة، لكنها بروفة INSERT-only
   لا `pg_dump` ولا استعادة منطقية كاملة ولا استعادة فيزيائية ولا اختبار على منصة مستضافة.
   **الاستعادة الفيزيائية/PITR: `UNVERIFIED` — لم تُجرَّب هنا، فلا تُوصَف بأنها سليمة دون تجربة فعلية.**
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
| ضوابط المشغّل السلبية (إلزامية، قبل RED) | 4 ضوابط على `run_checked` الحقيقي: خطأ متأخر بعد notices والـmarker بخروج psql فعلي 3؛ خطأ متأخر مع إخفاء رمز الخروج (0) عبر `ON_ERROR_STOP off`؛ marker مفقود؛ عدد notices خاطئ — كلها **مرفوضة** بسببها المحدد ولا تُطبع أي PASS؛ `M202_RUNNER_NEGATIVE_CONTROLS_PASS`. كل مجموعات الانحدار (M199 وM200/M201) وRED والقبول وآلية المالك تُشغَّل الآن بـ`run_checked`: رمز خروج psql الحقيقي 0 + خلوّ الخرج من `ERROR/FATAL/PANIC` + marker النجاح (+ عدد notices المطلوب = 70 تمامًا لـM199). أُزيل `|| true` الذي كان يخفي الفشل |
| ضوابط preflight/ذرية | 17 ضابطًا: بلا M201، انحراف كل من الدوال الخمس، نص M199 السابق لـ201 لدالتين، انحراف أجسام M199 الثلاثة، بلا USAGE على public، منح جدول لـauthenticated، trigger سابق يفتح الرسم (يُجهض كاملًا)، إعادة تطبيق، دور موجود |
| قبول 202 | 215 تأكيدًا + `M202_QC_PRIVILEGED_WRITE_CLOSURE_ACCEPTANCE_PASS`: سطح الامتيازات، المسار الحقيقي، التزوير (owner/same-owner/different-owner/marker/GUC/nested/replica)، **75** إشعار `mutant caught` = **73 حالة سلبية مرفوضة بسببها المحدد + ضابطان إيجابيان يتوقعان `<assertion passed>`** (عضوية ADMIN-only المتسامَح بها، وشكل السياسة السليم الجديد) — فلا يُقرأ الرقم 75 على أنه 75 mutant مرفوضًا (كان الرقم السابق 62 = 61 + ضابط إيجابي واحد). تشمل السلبية COLUMN_TYPE×2 وOPERATOR_CLASS وREWRITE_RULE وINHERITANCE، والجديد لسياسة الإدخال **13 حالة = 12 سلبية + ضابط إيجابي واحد**: ضابط الشكل السليم، مسند دالة SECURITY INVOKER بمالك مختلف، تعبير كتالوجي فقط، `false`، `true AND true`، إعادة توجيه إلى PUBLIC وإلى `service_role`، إعادة إنشاء RESTRICTIVE وFOR ALL، إعادة تسمية، سياسة RESTRICTIVE ALL إضافية، وتعديل مباشر لـ`pg_policy.polqual` و`polpermissive` للإثبات أن الفحصين غير فارغين)، وفحص نهاية-لنهاية: مع سياسة مسند تزيد sequence غير معاملي، الـRPC الحقيقي يُرفض بـ`POLICIES` **ولم تُنفَّذ دالة المسند** (الـsequence لم يتحرك)، وكـnon-vacuity: بتعطيل الحارس تتحرك الـsequence. (مسند `polqual` لا يمكن إنشاؤه بـDDL على سياسة INSERT؛ فُحص بتعديل كتالوج في عنقود مؤقت فقط)، و26 محاولة تزوير مرفوضة بسببها، و5 ضوابط non-vacuity (تعطيل الحارس أو إعادة المنح يجعل التزوير ينجح)، NULL والـsupersession (FINAL وIN_PROCESS ومرحلتان ودورتان وفساد)، ترتيب القائمة وحالتها (D1/D2/D3/D7: الدليل الحقيقي عند revision 1 يسبق صفًا قديمًا NULL-authority بتسلسل 999، تعادل التسلسل يحسمه id، NULL أخيرًا، رأس الشريحة = صف البوابة، `SUPERSEDED_AWAITING_REPLACEMENT` لـFINAL وللمرحلة فقط)، عقد ما بعد 201 |
| تصحيح `search_path` | `type_shadow_regression.sh`: `M202_TYPE_SHADOW_REGRESSION_PASS` — صفر إصابة بهوية مميّزة (GREEN) على مساري hold والكتابة معًا، وإصابة مؤكدة بعد عكس تصحيح `mo_quality_gate_199` عمدًا (RED، non-vacuity)، ثم عودة لصفر بعد الاستعادة |
| دوال M201 الخمس | المالك والـACL والجسم متطابقة قبل/بعد 202 |
| بروفة تحميل التاريخ INSERT-only (`history_rehearsal_seed.sql` ثم `_source.sql` ثم `history_rehearsal.sql` ثم `history_rehearsal_after.sql`، `M202_HISTORY_INSERT_ONLY_REHEARSAL_PASS`) | **ليست** `pg_dump` ولا استعادة منطقية كاملة ولا PITR ولا منصة مستضافة. نسخة مصدر تنتج 3 فحوص + 3 روابط سلطة عبر RPC الحقيقي وتُصدَّر CSV؛ نسخة هدف فارغة التاريخ. **الاتصال 1:** بصمة قبل (مالك/ACL الجدولين المحروسين والمخزنين الآخرين، ACL الأعمدة، مالك/ACL/إعدادات/جسم المسجِّل والدوال المرتبطة، خصائص دور المدخل وإعداداته وعضوياته وتبعياته، كل المشغّلات بحالتها وجسمها، القيود والفهارس والسياسات، ACL المخططين)؛ 13 تعديلًا يجب أن يغيّر كلٌّ منها البصمة (non-vacuity)؛ ضابط: التحميل بلا الإجراء مرفوض `QC_WRITE_PROVENANCE_REQUIRED_202`؛ ثم **الإجراء الموثّق كما هو** `BEGIN` ← `DISABLE TRIGGER qc_write_guard_202` على الجدولين ← `INSERT … SELECT` (الأب أولًا) ← `ENABLE ALWAYS` ← `COMMIT` (التزام فعلي، لا ROLLBACK)، وداخل النافذة: المشغّلان المسمّيان فقط معطّلان وبقية المشغّلات كما هي، UPDATE/DELETE/TRUNCATE مرفوضة على الجدولين، وFK لا يقبل رابطًا يتيمًا. الاتصال نفسه بعد COMMIT: قراءة البصمة (**جلسة واحدة فقط**). **اتصال ثالث مستقل** يرى 3/3 (دليل الالتزام)، ثم **عملية psql جديدة** تقرأ خط الأساس من ملف كُتب قبل التحميل (لا إعادة التقاط) وتتحقق: البصمة مطابقة، `qc_assert_closed_graph_202` ينجح، المشغّلان `ENABLE ALWAYS`، تطابق الصفوف مع المصدر (EXCEPT في الاتجاهين) وسلامة الـFK، البوابة تحترم الدليل المستعاد، الكتابة المباشرة مرفوضة (`authenticated`/`service_role` بـ`permission denied`، المالك/superuser حتى بـ`session_replication_role=replica` بـ`QC_WRITE_PROVENANCE_REQUIRED_202`، دور المدخل بلا marker)، UPDATE/DELETE/TRUNCATE مرفوضة، و**12 تعديلًا ملتزَمًا على الحالة الحية يجب أن يرفضها الأوراكل** (`assert_fp` ضد خط الأساس) ثم تُلغى، وRPC حقيقي بهوية `authenticated` ينجح ويسجّل فحصًا جديدًا (الترقيم `QI-000004` — العدّاد لم يُنقل مع الصفوف فتخطّى M199 الأرقام المحجوزة) دون تغيير البصمة. الرقابة في المشغّل: rc الفعلي + marker + عدم تطابق pid للاتصالين + بصمة قبل = بعد |
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
- **الاستعادة الفيزيائية/PITR: `UNVERIFIED`** — لم تُجرَّب في هذه الجلسة؛ لا تُستنتج سلامتها من كونها
  لا تمر عبر SQL (انظر §6 البند 3). بروفة تحميل التاريخ INSERT-only مُثبَتة على عنقود مؤقت (الإجراء وقراءاته في §6 البند 3 و§7)
  بما فيها بصمة المالك/ACL/المشغّلات قبل/بعد وقراءة من اتصال جديد؛ **لم** تُجرَّ `pg_dump`/استعادة منطقية كاملة
  (أجسام الجداول، التسلسلات، العدّاد `quality_inspection_counters`، الصلاحيات من تفريغ حقيقي) ولا PITR ولا منصة مستضافة.
- **سلسلة `auth.uid()` العابرة:** أُغلقت للمسارات الثلاثة المُثبَتة فعليًا (`wardah_assert_org_member`،
  `wardah_is_org_admin`، `quality_actor_can_199`) عبر §2أ؛ أي مسار آخر غير مفحوص يستدعي `auth.uid()` أو
  شيمًا مشابهًا بصياغة `search_path` غير آمنة **يبقى مفتوحًا ولم يُجرَد**.
- **الحدود البنيوية المضافة في §2 (COLUMN_TYPE/OPERATOR_CLASS/REWRITE_RULE/INHERITANCE):** كل واحدة
  مُثبَتة بـmutant حي واحد على الأقل؛ لم تُفحص تركيبات متزامنة أو DDL أخرى (مثل EVENT TRIGGER أو
  PUBLICATION) لم يُطلب فحصها صريحًا.
- **تصحيحات الجولة الأخيرة (الرأس بعد `7c4841ae`) — حدودها:** (1) تثبيت السياسة يغطي سياسة INSERT/ALL فقط؛
  سياسات SELECT/UPDATE/DELETE الأخرى على `quality_inspections` ليست جزءًا من العقد المثبّت. (2) محاذاة القائمة
  تعتمد على فعل `COALESCE(revision,0)` كالبوابة (انحراف موثق في §3)؛ القائمة تعرض شرائح FINAL لكل cycle بينما
  البوابة تقرأ cycle الـMO الحالي فقط، فحالة `SUPERSEDED_AWAITING_REPLACEMENT` لـcycle قديم لا تعني أن البوابة
  الحالية مغلقة بسببه. لم يُختبر الأداء على بيانات كبيرة (نافذة `row_number` فوق كل صفوف المؤسسة/الأمر قبل LIMIT).
  (3) مغلّف المشغّل `run_checked` يضمن أن فشل psql وخطأً متأخرًا لا يمرّان؛ لا يثبت صحة ما يطبعه الملف نفسه
  من notices، وهو لا يغطي `type_shadow_regression.sh` وconcurrency.py الذين يعتمدان على rc الفعلي لعملياتهما
  (`set -Eeuo pipefail`) وعلى markers.

### نتائج فحص الحواف (قراءة فقط، PostgreSQL 17.11 مؤقت، الرأس `1d1e4286`)

**أ) سياسات SELECT على `quality_inspections`.** تُنفَّذ مسندات سياسة SELECT فقط لقارئ خاضع لـRLS. ما وُجد: مالك الجدول `postgres` (superuser وBYPASSRLS في هذا العنقود)، `relforcerowsecurity = false`، لا عضو غير superuser في دور المالك، والأدوار `anon` و`authenticated` و`service_role` ودور المدخل **ليست مالكة** ولا تملك `SELECT` على الجدول (دور المدخل يملك `INSERT` فقط). `CREATE/ALTER/DROP POLICY` يتطلب ملكية الجدول أو superuser (قاعدة PostgreSQL)، فلا يملك أي دور من هذه الأربعة قدرة DDL على السياسات. دوال التحضير والتقييم والقائمة مملوكة لـpostgres وتقرأ الجدول بهوية المالك فلا تُقيَّم مسندات السياسة عليها هنا. السياسة الموجودة `quality_inspections_select_policy` (للجميع؛ شرط عضوية المؤسسة عبر `user_organizations` و`auth.uid()`) **غير مثبّتة** في `qc_assert_closed_graph_202`، ولا `FORCE ROW LEVEL SECURITY` مفحوص. **ما يستثنيه الضمان:** المالك وsuperuser ومن يستطيع أن يصير أحدهما (مدير DDL) يستطيع إضافة سياسة SELECT بمسند دالة وتفعيل FORCE RLS؛ فإن لم يكن المالك BYPASSRLS/superuser (حالة المنصة المستضافة **غير مُتحقَّق منها**) لعملت المسندات بهوية المالك داخل دوال التحضير/التقييم/القائمة قبل أن يصل أي INSERT إلى الحارس. لم يُعاد إنتاج هذا المسار هنا لأن مالك العنقود المؤقت superuser. السياسات الأخرى (SELECT/UPDATE/DELETE) وعلم FORCE خارج العقد المثبّت.

**ب) حالة القائمة مقابل البوابة (سلوك فعلي، مقاس):**

| الحالة | البوابة | القائمة |
|---|---|---|
| FINAL بـ`qc_cycle` فارغ (cycle 1 هو الحالي) | `QUALITY_RELEASE_REQUIRED` (تتجاهل الصف) | الصف `CURRENT`، `awaiting=false` — الحالة نسبة إلى الشريحة لا إلى صلة البوابة |
| cycle 1 مُتجاوَز بلا بديل ثم صار cycle 2 بفحص PASS حقيقي | `ready=true` على cycle 2 | صف cycle 1 `SUPERSEDED_AWAITING_REPLACEMENT` بينما البوابة الحالية مفتوحة — الحالة لا تعني أن **البوابة الحالية** مغلقة إلا للـcycle الحالي |
| رابط `authority_revision=5` على شريحة لم تبلغ 5 | `QUALITY_AUTHORITY_CORRUPT` (محجوبة) | الصف يُعرض `CURRENT` **وفي الرأس** قبل الصف الحقيقي الذي تعرضه البوابة؛ لا مؤشر فساد |
| رابط بـ`org_id` لمؤسسة أخرى | `QUALITY_AUTHORITY_CORRUPT` | `CURRENT`، بلا مؤشر فساد |
| رابط مرحلة بـrevision 4 في نطاق `final_only` | `ready=true` (لا تفحص المراحل في هذا النطاق) | `CURRENT` |

وعليه: قولنا «الصف الأول في الشريحة هو صف البوابة» صحيح للبيانات السليمة وللـcycle الحالي فقط؛ مع فساد الرابط تُظهر القائمة الصف الفاسد ولا تُعلِن الفساد، والبوابة هي من ترفض. لم يُغيَّر الكود لهذا.

**ج) المشغّل.** الضابط السلبي بإشعارين يختبر فرع رمز الخروج وفرع نص الخطأ وفرع الـmarker وفرع العدد، وكلها في `run_checked` نفسه الذي يستدعيه انحدار M199 بالعدد 70. حالة «70 إشعارًا + `M199_QUALITY_CONTROL_ACCEPTANCE_PASS` ثم خطأ» اختُبرت صناعيًا عبر `run_checked` الفعلي: مقبولة بلا خطأ؛ وبخطأ متأخر → `psql exit code 3` مرفوضة؛ وبرمز خروج مُخفى (0) مع `ERROR` → مرفوضة. بعد الإزالة لا يبقى إخفاء ذو معنى لرمز خروج psql: `|| true` المتبقية في تنظيف `dropdb/DROP ROLE` وفي أوامر `grep|head` التشخيصية بعد قرار الرفض فقط؛ مسارات `psql ... >/dev/null 2>&1` في بناء السلسلة تحتفظ برمز الخروج (`ON_ERROR_STOP` و`set -e`)، وأنابيب `tee/tail` محمية بـ`pipefail`. ملاحظة تسمية: السطر المطبوع `acceptance mutants caught: 75` يعدّ إشعارات `mutant caught` ويشمل ضابطين إيجابيين (73 سلبية + 2 إيجابية).
