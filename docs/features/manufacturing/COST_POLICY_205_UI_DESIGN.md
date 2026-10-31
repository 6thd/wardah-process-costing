# تصميم واجهة سياسة التكلفة 205 ضمن `/settings/manufacturing`

**الحالة:** تصميم للمراجعة (2026-10-31). **لا كود واجهة ولا SQL ولا دمج ولا نشر.** لا يأذن هذا الملف بالتنفيذ.

**الأساس:** عقود `sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql` عند `444e653f` (#331، مقبول الفرق الأخير دون إصلاح برمجي، وغير مطبق على أي قاعدة مستضافة)، وواجهة 204 القائمة في `src/features/settings/manufacturing/` و`src/services/mfg-cost-policy-service.ts`. ترتيب النشر في `docs/db/MIGRATION_205_TRANSITION_PLAN.md`.

**خارج هذا التصميم:** بقية محرك #260، و#230، و#234، وتحرير سجلات الإنتاج، واستئناف الاستخدام، ومراكز التكلفة.

## 1) المبادئ

1. **الخادم هو الحكم.** `GRANT EXECUTE TO authenticated` يعني أن الدالة قابلة للاستدعاء، لا أن المستخدم مأذون. كل زر يُظهَر من `capabilities` في `rpc_get_mfg_cost_policy_205`، وكل رد `42501` يحدّث الشاشة ويعرض السبب.
2. **`capabilities` للعرض فقط، ولا تحل محل فحص الخادم.** قد تكون قديمة بعد سحب دور، فلا يبنى عليها قرار آمن.
3. **الفشل يغلق الكتابة.** أي حالة غير مؤكدة تعطل الكتابة، ولا تعود أبدًا إلى المسار القديم.
4. **المعتمِد يعتمد ما رآه.** الزر يرسل رقم المراجعة المعروض على الشاشة نفسها، لا آخر رقم في الذاكرة.
5. **لا حساب في العميل.** كل مبلغ يعرض من رد الخادم. فحوص النموذج تخدم الإدخال فقط، ولا تبدل فحص الخادم.
6. **لا إسقاط صامت.** الموازنة غير المحمّلة تظهر باسمها ومبلغها في قسم منفصل، وخارج أي إجمالي للمنتج.
7. **لا خيار بلا مسار حفظ.** مراكز التكلفة لا تظهر كخيار عامل (§12).

## 2) اكتشاف 205

الفحص هو استدعاء `rpc_get_mfg_cost_policy_205(p_org_id)` نفسه، لا حالة ثابتة في البناء. ينتج أربع حالات:

| الحالة | الشرط بالضبط | السلوك |
|---|---|---|
| `absent` | الخطأ `code === 'PGRST202'` على هذا الاستدعاء | لوحة 204 كما هي، مع قرار الإنشاء أثناء الإيقاف (قرار المالك Q-3 في خطة الانتقال) |
| `present` | نجاح الاستدعاء وتحقق شكل الرد | لوحة 205، ومسار الإنشاء القديم مخفي للجميع |
| `denied` | `MANUFACTURING_SETTINGS_READ_DENIED` | تنبيه عدم صلاحية؛ لا لوحة 204 ولا إنشاء. وجود هذا الرمز يعني أن 205 مطبقة |
| `unknown` | أي خطأ آخر: انقطاع، 5xx، خطأ PostgREST آخر، رد بشكل غير متوقع | تنبيه خطأ وزر إعادة المحاولة، **بلا أي كتابة وبلا لوحة 204** |

**قواعد حماية الاكتشاف:**

- `absent` لا يُستنتج إلا من `PGRST202`. نص الرسالة وحده (`Could not find the function`، المستخدم في `throwRpcError` الحالي) لا يكفي في الاكتشاف، لأنه يخلط الغياب بأخطاء أخرى.
- `PGRST202` من دالة 205 **أخرى** بعد `present` خطأ عقد، ويعامل `unknown`، لا غيابًا. فالنسخة المطبقة والعميل لا يتفقان.
- `absent` لا يبقى في الذاكرة: `staleTime: 0`، وإعادة فحص عند العودة إلى التبويب، وعند فتح النموذج.
- **قبل كل إرسال على مسار الإنشاء القديم** يُعاد الفحص. إن لم يكن الناتج `absent` يتوقف الإرسال وتتحول الشاشة. هذا يضيّق النافذة ولا يغلقها: نسخة عميل قديمة محملة لا تنفذ هذا الفحص، ولذلك يبقى الإغلاق التقني مطلوبًا.
- بعد التطبيق قد يبقى رد `absent` لحظات حتى تتحدث ذاكرة PostgREST. الحالة تتصحح بالفحص التالي، والخطة تتحقق منها صراحة.

## 3) هيكل الشاشة

`CostPolicyTab` يصبح مفتاحًا رفيعًا يقرأ حالة الاكتشاف ويعرض إحدى لوحتين. يبقى كود 204 الحالي كما هو داخل `CostPolicy204Panel` حتى يُزال في طلب التنظيف.

| القسم في `CostPolicy205Panel` | المحتوى | يظهر لـ |
|---|---|---|
| شريط الحالة | سياسة الشركة: الاعتماد الذاتي، وسياسة الموازنات غير الموزعة، وتنبيه الإيقاف الإداري إن كان ساريًا | كل قارئ |
| بانتظار القرار | المسودات بحالة `draft`: النوع، والمراجعة، والمنشئ، والتحذيرات (§6) | كل قارئ؛ الأزرار حسب §4 |
| الإصدارات | جدول 204 مع عمود `policy_205`: `approved_205` أو `legacy_resolved` أو `legacy_unresolved` | كل قارئ |
| الإصدارات القديمة غير المعالجة | قائمة، ومسار المعالجة (§9) | تظهر إن وجد إصدار غير مسحوب وغير معالج |
| سجل المسودات | المعتمدة والمرفوضة والمسحوبة، بالقرار والسبب | كل قارئ |
| إعدادات الاعتماد | الحالة، والتغيير، وسجل `settings_audit` (§8) | كل قارئ؛ التغيير حسب القدرة |
| المعاينة | المعاينة 205 (§10) | كل قارئ |

## 4) ربط كل إجراء بالعقد والصلاحية

**التوقيعات كما في الملف.** عمود «إظهار الزر» للعرض، و«فحص الخادم» هو الحكم.

| الإجراء | RPC | فحص الخادم | إظهار الزر | الرد |
|---|---|---|---|---|
| قراءة الشاشة | `rpc_get_mfg_cost_policy_205(p_org_id uuid)` | عضو نشط، و(`manufacturing.settings.read` أو تحديث M201 أو `manufacturing.cost_policy.approve`) | تلقائي | الحالة الكاملة و`capabilities` |
| إنشاء مسودة إصدار | `rpc_create_mfg_cost_policy_draft_205(p_org_id uuid, p_draft jsonb, p_expected_latest_version_no integer, p_idempotency_key uuid)` | `manufacturing_settings_can_update_201` | `can_create` | `draft_id`, `status`, `revision`, `replayed` |
| تعديل مسودة | `rpc_update_mfg_cost_policy_draft_205(p_org_id uuid, p_draft_id uuid, p_draft jsonb, p_expected_latest_version_no integer)` | تحديث M201، والمنشئ وحده، ونوع `version` | `can_create` والمنشئ هو الجلسة والنوع `version` | `revision`, `unchanged` |
| سحب مسودة | `rpc_withdraw_mfg_cost_policy_draft_205(p_org_id uuid, p_draft_id uuid, p_reason text)` | المنشئ وحده، **دون فحص صلاحية أخرى**، والسبب 1–500 | المنشئ هو الجلسة | `status: withdrawn` |
| رفض مسودة | `rpc_reject_mfg_cost_policy_draft_205(p_org_id uuid, p_draft_id uuid, p_reason text)` | `manufacturing.cost_policy.approve` (يشمل المنشئ إن كان يحملها)، والسبب 1–500 | `can_approve` | `status: rejected` |
| اعتماد | `rpc_approve_mfg_cost_policy_draft_205(p_org_id uuid, p_draft_id uuid, p_expected_revision integer)` | `approve`؛ وللمنشئ: الإعداد مفعل و`self_approve` مسندة | غير المنشئ: `can_approve`. المنشئ: `can_self_approve` | `policy_version_id`, `self_approved`, `unallocated`, `exception` |
| مسودة معالجة قديمة | `rpc_create_legacy_resolution_draft_205(p_org_id uuid, p_policy_version_id uuid, p_resolution jsonb, p_reason text, p_idempotency_key uuid)` | تحديث M201، والسبب 1–500 | `can_create` | كالإنشاء |
| تغيير الاعتماد الذاتي | `rpc_set_cost_policy_self_approval_205(p_org_id uuid, p_enabled boolean, p_reason text)` | `approval_settings.manage` بإسناد صريح | `can_manage_approval_settings` | الإعدادات |
| تغيير سياسة الموازنات غير الموزعة | `rpc_set_cost_policy_unallocated_policy_205(p_org_id uuid, p_policy text, p_reason text)` | مدير المؤسسة **و**`unallocated_policy.manage` بإسناد صريح | `can_manage_unallocated_policy` | الإعدادات |
| معاينة | `rpc_preview_mfg_cost_absorption_205(p_org_id uuid, p_policy_version_id uuid, p_work_center_id uuid, p_hours jsonb, p_recorded_labor_cost numeric)` | كالقراءة | لإصدار غير مسحوب | مبالغ بالريال و`unallocated_budgets` و`cents` |

**مساران من 204 يبقيان بعد الانتقال:**

- `rpc_get_mfg_cost_policy`: لا تستخدمه لوحة 205. حامل `approve` وحده لا يقرأ به.
- `rpc_withdraw_mfg_cost_policy_version`: الطريق الوحيد لسحب إصدار، ويشمل الإصدار المعتمد بمسار 205. يتطلب تحديث M201 لا `approve`، وهذا قرار مالك (Q-4).

## 5) حالات المسودة

| الحالة | المنشئ | حامل `approve` غير المنشئ | حامل الاعتماد الذاتي | ملاحظة |
|---|---|---|---|---|
| `draft` من نوع `version` | تعديل، سحب | اعتماد، رفض | اعتماد | |
| `draft` من نوع `legacy_resolution` | سحب **فقط** | اعتماد، رفض | اعتماد | لا تعديل: الخادم يرد `COST_POLICY_DRAFT_EDIT_DENIED`. التصحيح بسحبها وإنشاء أخرى |
| `approved` | عرض | عرض | عرض | تربط `result_version_id` بالإصدار |
| `rejected`, `withdrawn` | عرض، و«نسخ إلى مسودة جديدة» | عرض | عرض | لا عودة من هاتين الحالتين |

**أثر الجلسة:** المقارنة بالمنشئ تستخدم معرف جلسة Supabase، ولا تُرسل هوية إلى الخادم. حمولة تحمل حقل هوية تُرفض بـ`COST_POLICY_DRAFT_IDENTITY_FIELD`.

**الأسماء:** الرد يعيد معرفات المستخدمين لا أسماءهم. يعرض النص «أنت» للجلسة، ومعرفًا مختصرًا لغيرها، حتى يوجد مصدر مأذون للأسماء. لا يُضاف استعلام مباشر لجداول المستخدمين.

## 6) ربط الاعتماد بالمراجعة وتعارض التعديل

**تدفق الاعتماد:**

1. نافذة الاعتماد تعرض لقطة المسودة كما وردت في آخر قراءة، مع رقم المراجعة ظاهرًا.
2. تُجمَّد اللقطة ما دامت النافذة مفتوحة. وتحديث الخلفية لا يبدل محتواها، وإنما يعرض «توجد نسخة أحدث».
3. الزر يرسل `p_expected_revision` من اللقطة نفسها.

**الردود:**

| الحالة | الرمز | السلوك |
|---|---|---|
| عدلت المسودة بعد العرض | `COST_POLICY_DRAFT_REVISION_CONFLICT: current=n` | لا شيء كُتب. تُقرأ المسودة، ويُعرض الجديد مقابل ما رُئي، ويُطلب اعتماد جديد. **لا إعادة إرسال آلية برقم جديد** |
| قُرر فيها غيرك | `COST_POLICY_DRAFT_NOT_PENDING` | تحديث وعرض الحالة الحالية |
| انقطع الرد بعد إرسال الاعتماد | انقطاع، أو `NOT_PENDING` عند الإعادة | **الاعتماد بلا مفتاح تكرار.** تُعاد القراءة أولًا: إن صارت `approved` بالمعرف نفسه ورقم المراجعة نفسه يعرض نجاح. لا إعادة إرسال قبل القراءة |
| تغير آخر إصدار | `COST_POLICY_VERSION_CONFLICT: latest=n` | المسودة صارت قديمة (أدناه) |

**المسودة القديمة:** `expected_latest_version_no` يثبت عند الحفظ. أي إصدار جديد، ولو من مسار 204، يجعل كل مسودات الإصدار المعلقة غير قابلة للاعتماد.

- تُعلَّم قبل الضغط: `draft.expected_latest_version_no !== latest_version_no`.
- زر الاعتماد يتعطل مع السبب، ويبقى الرفض متاحًا.
- للمنشئ زر «تحديث الأساس»: يعيد الحفظ بالرقم الجديد. هذا تعديل للمحتوى فترتفع المراجعة، ويعيد المعتمِد المراجعة. وهذا مقصود.
- غير المنشئ لا يستطيع التحديث. مسودة منشئ غائب تُرفض بسبب، ثم تُنسخ إلى مسودة جديدة.

**تاريخ السريان:** يُفحص عند الحفظ وعند الاعتماد. مسودة فات تاريخها ترد `COST_POLICY_EFFECTIVE_DATE_IN_PAST`؛ والمنشئ يعدّل التاريخ.

**الحفظ دون تغيير:** الرد `unchanged: true`. تعرض الواجهة «لا تغييرات» ولا تعرض رقم مراجعة جديدًا.

**مفتاح التكرار للإنشاء:** مفتاح واحد لكل محتوى يُرسل. تعديل المحتوى بعد فشل الإرسال يولد مفتاحًا جديدًا، وإلا رد الخادم `COST_POLICY_IDEMPOTENCY_CONFLICT`. وإعادة الإرسال بعد انقطاع بالمحتوى نفسه والمفتاح نفسه تعيد المسودة نفسها (`replayed`). لاحظ أن البصمة تشمل `expected_latest_version_no`.

## 7) نموذج المسودة

يوسّع `CostPolicyVersionForm`. كل مفاتيح الحمولة حرفية من الفحص في الخادم:

| القسم | الحقول | قواعد الإدخال |
|---|---|---|
| حقول 204 | `effective_from`, `labor_cost_source`, `default_labor_rate_per_hour`, `pin_event`, `note`, `work_center_rules` | كما في 204 |
| المجمعات | `overhead_pools[]`: `pool_code`, `name`, `name_ar`, `basis`, `rate`, `activity`, `budgets` | `rate` **رقم JSON** لا نص، موجب، 6 خانات عشرية على الأكثر، حتى 999999999 |
| الموازنات | `budgets[]`: `budget_code`, `gl_account_id`, `setup_related`, `amount`, `planned_hours` | الرمز `^[A-Z][A-Z0-9_]{1,29}$`، حتى 100 موازنة. الحساب مطلوب عند الاعتماد. لا حقل مركز تكلفة |
| إقرار الإعداد | `setup_acks[]`: `pool_code`, `budget_code` | يظهر فقط لموازنة `setup_related` في مجمع نشاطه `run` |
| الاستثناء | `unallocated_exception`: `budgets` (قائمة رموز)، `reason`, `treatment` | يظهر فقط تحت `controlled_exception`. القائمة تملأ آليًا بكل غير المحمّل، للقراءة فقط |

**نقص مهم:** الإنشاء والتعديل يفحصان الشكل والملكية وحقول 204 فقط. قواعد `validate_205` (مجمع بلا موازنة، موازنة مكررة في مجمعين، نشاط غير محدد، إقرار ناقص) لا تعمل إلا عند الاعتماد. فمسودة محفوظة قد تكون غير قابلة للاعتماد. الواجهة تعرض تنبيهات إدخال مبكرة، لكنها تنبيهات لا ضمان. الحل الخادمي قرار مالك (Q-1).

**الدقة:** المعدل يصل JSON كرقم، فيدخل النص إلى `Number()` بعد تحقق نمطي من عدد الخانات. والمبالغ تعرض بسلسلة منسقة من رد الخادم.

## 8) إعدادات الاعتماد

| الإعداد | القيمة الافتراضية | من يغيّر | ما يراه غيره |
|---|---|---|---|
| الاعتماد الذاتي `self_approval_enabled` | مغلق | حامل `approval_settings.manage` بإسناد صريح | الحالة وسجل التغيير |
| سياسة `unallocated_budget_policy` | `block` | مدير المؤسسة **مع** `unallocated_policy.manage` بإسناد صريح | الحالة وسجل التغيير |

- السبب إلزامي، 1–500 حرف، في نافذة تأكيد تبين الأثر.
- `approve` لا تمنح تغيير أي إعداد، ولا `approval_settings.manage` تغيّر السياسة.
- مشرف المنصة ومدير المؤسسة دون إسناد صريح لا يغيران الإعدادين. الواجهة لا تعرض لهما تلميحًا بتجاوز.
- إعادة الإرسال بعد انقطاع ترد `COST_POLICY_SETTING_UNCHANGED`. تعامل كنجاح **بعد** قراءة تؤكد القيمة.
- تغيير السياسة يسري على الاعتمادات التالية فقط. نص الشاشة يذكر أن الإصدار المعتمد لا يعاد فتحه.
- **المسودة المعلقة تتأثر:** الاعتماد يقرأ السياسة وقت الاعتماد، فمسودة باستثناء تحت `block` ترفض بـ`COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED`.
- المفاتيح الأربعة تظهر في شاشة الأدوار. المفاتيح الثلاثة الصريحة لا تُمنح من توسيع القالب `manufacturing.%`، فالتوثيق داخل الشاشة يوضح أنها تسند بالاسم.

## 9) الإصدارات القديمة

الإصدار القديم = `policy_205 = 'legacy_unresolved'` وغير مسحوب. لا يُعدل، ولا يعاد تثبيته، ولا يحذف.

| الخطوة | السلوك |
|---|---|
| العرض | قائمة بالرقم والتاريخ والمجمعات، وعدد الأوامر المثبتة عليه، وتحذير: المعاينة 205 والحساب يرفضانه حتى يُعالج |
| بدء المعالجة | نموذج خارج الإصدار: لكل مجمع `activity` و`budgets`، وموازنات، وإقرارات، وسبب إلزامي |
| التغطية | يجب أن تغطي المعالجة مجمعات الإصدار بالضبط. تملأ القائمة آليًا من `data_205`، ويُرفض النقص عند الاعتماد بـ`COST_POLICY_LEGACY_POOLS_MISMATCH` |
| الاعتماد | المسار والصلاحيات والمراجعة نفسها (§6) |
| بعد الاعتماد | `legacy_resolved`، والمعاينة تعمل، والبيانات مقروءة من الجداول الجانبية. صفوف الإصدار لا تتغير |

**معالجتان متوازيتان لإصدار واحد:** لا قيد يمنع مسودتين معلقتين. الثانية تفشل عند الاعتماد بـ`COST_POLICY_LEGACY_NOT_APPLICABLE`. الواجهة تعطل «بدء المعالجة» إذا وجدت مسودة معلقة للإصدار.

## 10) المعاينة 205

- **للإصدارات المخزنة فقط:** الدالة تأخذ `p_policy_version_id`. **لا توجد معاينة لمسودة** (Q-1).
- لا تستخدم لوحة 205 معاينة 204 أبدًا: فهي لا تعرف نشاط المجمع وتعطي رقمًا مضللًا لإصدار 205.
- إصدار `legacy_unresolved`: زر المعاينة معطل مع السبب، والخادم يرد `COST_POLICY_LEGACY_UNRESOLVED`.
- الساعات أربعة حقول: `p_hours = {labor: {run, setup}, machine: {run, setup}}`. الفارغ غير مُرسل (غير مقاس)، والصفر مقاس. الخادم يطلب ما يحتاجه الحساب فقط (`COST_POLICY_DRIVER_MISSING: labor.setup`).
- التكلفة المسجلة تظهر فقط لـ`recorded_entry_rate`. كسر السنت يرفض بـ`COST_POLICY_RECORDED_COST_INVALID`.
- **إبطال النتيجة:** يُعاد استخدام نمط `matchesInputs` الحالي بمقارنة المدخلات المرسلة بالحالية. أي تغيير في الإصدار أو المركز أو الساعات أو المبلغ يخفي النتيجة والخطأ، ويغطي ردًا يصل متأخرًا. ويضاف شرط أن الإصدار ما زال ضمن القائمة الحية.
- النتيجة: العمالة، وسطر لكل مجمع بنشاطه، والمجمعات المستبعدة، وإجمالي الأوفرهيد، والإجمالي، ثم قسم منفصل للموازنات غير المحمّلة (§11).

## 11) الموازنات غير المحمّلة

| الموضع | المصدر | الوحدة |
|---|---|---|
| قائمة المسودات | `drafts[].unallocated_budgets` | المبلغ **كما أُدخل**، وقد يكون فارغًا |
| رد الاعتماد | `unallocated` | **هللات** (`{رمز: سنتات}`) |
| الإصدار المعتمد | `unallocated_exception.budgets` | ريال |
| المعاينة | `unallocated_budgets` | ريال |

- يفرض طبقة تحويل واحدة في الخدمة، ولا تُعرض قيمة `unallocated` مباشرة. خلط الوحدات يعرض مبلغًا مئة ضعف.
- **تحت `block`:** تنبيه قبل الاعتماد أن المسودة سترفض، بقائمة الموازنات. لا يوجد خيار تجاوز.
- **تحت `controlled_exception`:** المنشئ يكتب السبب والمعالجة في المسودة. والمعتمِد يرى الموازنات ومبالغها والسبب والمعالجة قبل الزر، ويسجل المعتمد من الجلسة.
- **العرض في كل موضع:** عنوان «موازنات غير محمّلة على المنتج» خارج جدول الأوفرهيد، ولا تدخل في أي إجمالي معروض. والقسم يذكر أن معالجتها المحاسبية خارج هذا الحساب.
- تعديل السبب أو المعالجة تعديل للمحتوى، فترتفع المراجعة.

## 12) مراكز التكلفة

`supported.cost_centers_accepted = false`، والخادم يرفض كل مركز بـ`COST_POLICY_COST_CENTER_FOREIGN`.

- لا حقل مركز تكلفة في النموذج، ولا عمود فارغ، ولا خيار معطل يوحي بقرب الدعم.
- نص ثابت بجوار الموازنات: «النطاق المتاح: الحساب العام».
- النموذج لا يرسل `cost_center_id`. ويتحقق اختبار من ذلك.
- لا يعتمد العرض على أن القيمة ستتغير؛ فأي دعم لاحق يحتاج تصميمًا وقرارًا منفصلين.

## 13) الوصول إلى الشاشة

**فجوة قائمة:** `SETTINGS_MANUFACTURING` في `src/config/route-permissions.ts` يقبل `manufacturing.settings.read` و`update` فقط، و`SETTINGS_OVERVIEW` كذلك. فمن يحمل `manufacturing.cost_policy.approve` وحده يقرأ بـ205 خادميًا لكنه لا يصل إلى الصفحة.

**التصميم:**

- إضافة `manufacturing.cost_policy.approve` إلى `anyOf` في الاثنين، وإلى `canReadManufacturingSettings`.
- الصفحة تستدعي `getQualityPolicy` على مستوى الصفحة وقد تُرفض لهذا المستخدم. لذلك يُعرض تبويب سياسة التكلفة مفتوحًا، ولا تُعرض بقية التبويبات له.
- في حالة `absent` لا يوجد هذا المفتاح أصلًا، فلا أثر للتعديل قبل التطبيق.

## 14) خريطة الأخطاء

كل الرموز التالية من ملف 205 أو الدوال التي يستدعيها، ويفحص ذلك مولد في الأدلة. الإجراء العام: رسالة مترجمة مع التفصيل بعد `:`، ثم الإجراء المذكور.

| المجموعة | الرموز | الإجراء |
|---|---|---|
| صلاحية | `MANUFACTURING_SETTINGS_READ_DENIED`, `MANUFACTURING_SETTINGS_UPDATE_DENIED`, `COST_POLICY_APPROVE_DENIED`, `COST_POLICY_APPROVAL_SETTINGS_DENIED`, `COST_POLICY_UNALLOCATED_POLICY_DENIED`, `COST_POLICY_DRAFT_EDIT_DENIED`, `COST_POLICY_SELF_APPROVAL_NOT_ALLOWED` | تحديث الحالة والقدرات، وإخفاء الزر |
| تزامن | `COST_POLICY_DRAFT_REVISION_CONFLICT`, `COST_POLICY_DRAFT_NOT_PENDING`, `COST_POLICY_VERSION_CONFLICT`, `COST_POLICY_DRAFT_UNKNOWN`, `COST_POLICY_VERSION_UNKNOWN`, `COST_POLICY_IDEMPOTENCY_CONFLICT`, `COST_POLICY_IDEMPOTENCY_KEY_REQUIRED` | إعادة قراءة؛ السلوك في §6 |
| مسودة ثابتة | `COST_POLICY_DRAFT_IMMUTABLE`, `COST_POLICY_DRAFT_REVISION_INVALID`, `COST_POLICY_IMMUTABLE` | لا يفترض وصولها من العميل؛ تعرض خطأ عقد وتسجل |
| أسباب | `COST_POLICY_DECISION_REASON_REQUIRED`, `COST_POLICY_LEGACY_REASON_REQUIRED`, `COST_POLICY_SETTING_REASON_REQUIRED` | تركيز حقل السبب |
| إعدادات | `COST_POLICY_SETTING_UNCHANGED`, `COST_POLICY_UNALLOCATED_POLICY_INVALID` | قراءة؛ §8 |
| هوية وشكل | `COST_POLICY_DRAFT_IDENTITY_FIELD`, `COST_POLICY_UNKNOWN_KEY`, `COST_POLICY_INVALID` | خطأ عقد، لأن النموذج لا يرسلها |
| موازنات | `COST_POLICY_BUDGET_ACCOUNT_REQUIRED`, `COST_POLICY_BUDGET_AMOUNT_INVALID`, `COST_POLICY_BUDGET_CODE_DUPLICATE`, `COST_POLICY_BUDGET_DOUBLE_ALLOCATION`, `COST_POLICY_BUDGET_DUPLICATE_SOURCE`, `COST_POLICY_BUDGET_SOURCE_OVERLAP`, `COST_POLICY_BUDGET_UNALLOCATED`, `COST_POLICY_BUDGET_UNKNOWN`, `COST_POLICY_GL_ACCOUNT_FOREIGN` | إبراز السطر بالتفصيل |
| مجمعات | `COST_POLICY_POOL_ACTIVITY_UNSET`, `COST_POLICY_POOL_BASIS_UNSUPPORTED`, `COST_POLICY_POOL_CODE_DUPLICATE`, `COST_POLICY_POOL_WITHOUT_BUDGET`, `COST_POLICY_POOLS_REQUIRED`, `COST_POLICY_SETUP_ACK_INVALID`, `COST_POLICY_SETUP_TREATMENT_UNSET` | إبراز المجمع |
| معدلات ومراكز عمل | `COST_POLICY_RATE_INVALID`, `COST_POLICY_LABOR_RATE_MISSING`, `COST_POLICY_LABOR_RATE_NOT_APPLICABLE`, `COST_POLICY_LABOR_SOURCE_UNSUPPORTED`, `COST_POLICY_STAGE_METHOD_UNSUPPORTED`, `COST_POLICY_PIN_EVENT_UNSUPPORTED`, `COST_POLICY_WC_POOL_DUPLICATE`, `COST_POLICY_WC_POOL_RATE_INVALID`, `COST_POLICY_WC_POOL_UNKNOWN`, `COST_POLICY_WC_RULE_EMPTY`, `COST_POLICY_WORK_CENTER_DUPLICATE`, `COST_POLICY_WORK_CENTER_UNKNOWN` | إبراز الحقل؛ وفي المعاينة رسالة |
| تواريخ | `COST_POLICY_EFFECTIVE_DATE_IN_PAST`, `COST_POLICY_EFFECTIVE_DATE_NOT_AFTER_LATEST` | إبراز التاريخ |
| استثناء | `COST_POLICY_UNALLOCATED_EXCEPTION_INVALID`, `COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED` | قسم الاستثناء؛ §11 |
| قديم | `COST_POLICY_LEGACY_NOT_APPLICABLE`, `COST_POLICY_LEGACY_POOLS_MISMATCH`, `COST_POLICY_LEGACY_UNRESOLVED` | §9 |
| مراكز تكلفة | `COST_POLICY_COST_CENTER_FOREIGN` | خطأ عقد؛ النموذج لا يرسله |
| حساب | `COST_POLICY_DRIVER_MISSING`, `COST_POLICY_HOURS_INVALID`, `COST_POLICY_RECORDED_COST_INVALID` | إبراز حقل المعاينة |

## 15) فجوات العقد الحالي

ليست عيوبًا في المقبول من #331، لكنها تحدد ما تستطيع الواجهة فعله:

| # | الفجوة | الأثر | المعالجة |
|---|---|---|---|
| F-UI-1 | لا فحص ولا معاينة لمسودة | المعتمِد لا يرى رقمًا محسوبًا قبل كتابة إصدار ثابت، وأخطاء القواعد تظهر عند الاعتماد | Q-1 |
| F-UI-2 | السحب بعد الاعتماد بصلاحية إعدادات لا `approve` | سحب إصدار مستقبلي معتمد لا يمر بالمعتمِد | Q-4 |
| F-UI-3 | الاعتماد بلا مفتاح تكرار | إعادة القراءة قبل الإعادة (§6) | تصميم، بلا تغيير خادم |
| F-UI-4 | مسار الوصول لا يشمل `approve` | §13 | في طلب الواجهة |
| F-UI-5 | مسودة القديم لا تعدل | سحب وإنشاء | تصميم، بلا تغيير خادم |
| F-UI-6 | لا أسماء مستخدمين في الرد | عرض «أنت» ومعرف مختصر | تصميم الآن، وتحسين لاحق |
| F-UI-7 | الرفض لا يأخذ رقم المراجعة | قبله المراجع: لا يكتب إصدارًا | تعرض الواجهة المراجعة المرفوضة للعلم |
