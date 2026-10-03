# جرد «إعدادات التصنيع» وتقاطعها مع نوافذ الواجهة وقاعدة البيانات — 2026-10-03

**السؤال:** هل يوجد قسم إعدادات للتصنيع؟ وأين تُخزَّن كل قيمة تتحكم في سلوك التصنيع،
ومن يكتبها، ومن يقرؤها، وأي نافذة تتأثر بها؟

**الجواب المختصر:** **لا يوجد قسم «إعدادات التصنيع» في `main`.** لا مسار
`/manufacturing/settings`، ولا بطاقة تصنيع في `/settings`، ولا مفتاح صلاحية
`manufacturing.settings.*` أو `settings.manufacturing.*`. في المقابل توجد **اثنا عشر مخزن
إعدادات متفرقًا** في قاعدة البيانات، إضافة إلى ملفَّي إعدادات في العميل، تؤثر في التصنيع (§3)، بأربعة أنماط حماية مختلفة، أغلبها بلا واجهة،
وبعض ما له واجهة **لا يستطيع الحفظ** بسبب RLS. ويوجد مسودتا PR مفتوحتان تضيفان صفحتي
إعدادات للتصنيع **في مكانين مختلفين** (§2.3).

**مصدر الأدلة:**

- المستودع: `main@3d01f99` (Baseline `sql/baseline/000_schema_baseline_20260905_184634.sql`
  — لقطة `pg_dump` من Production عند cutoff 189 — ثم Migrations 190–199 في المستودع).
- حالة Production المعتمدة من `CLAUDE.md`: 190–194 مطبّقة؛ **195–199 مستودع فقط**.
- مسودات PR المفتوحة: #292 و#304 (قُرئت فروقها عن `main` فقط، لم تُشغَّل).
- **لم تُنفَّذ أي قراءة حية على Production في هذا الجرد.** كل بند موسوم «يحتاج تحققًا حيًا»
  استُنتج من الـBaseline والمستودع، ومرفق له استعلام قراءة فقط في §8.

**طبيعة الوثيقة:** جرد وتوصية فقط. لا تغيّر أي Migration أو كود، ولا تجيز تطبيق شيء على
Production أو Staging.

الرموز: ✅ موجود وموصول — 🟡 موجود لكنه خامل/ناقص/غير موصول — ❌ غير موجود —
⛔ معطوب (يشير إلى كائن غير موجود أو تمنعه RLS).

---

## 1) الخلاصة التنفيذية

| # | النتيجة | الخطورة |
|---|---|---|
| MS-01 | جدول `gl_event_mappings` — الذي يحدد حسابات قيود صرف المواد والإنتاج التام والأعباء — **قابل للكتابة المباشرة من أي عضو** في المؤسسة (سياسة `ALL` بفحص المؤسسة فقط، و`GRANT ALL` لـ`authenticated` و`anon`)، بينما الـRPC الرسمية لتعديله `rpc_upsert_event_mapping` محصورة في `service_role`. | **عالية (أمن/محاسبة)** |
| MS-02 | لا يوجد بيت واحد لإعدادات التصنيع؛ اثنا عشر مخزنًا متفرقًا (S1–S12)، ومسودتان (#292، #304) تضعان صفحات الإعدادات في `/manufacturing/...` و`/settings/...` على التوالي. | عالية (تشغيل) |
| MS-03 | الجداول `labor_time_logs` و`moh_applied` و`process_costs` **غير موجودة** في Baseline Production، ويعتمد عليها مساران بفشلين مختلفين: **(أ)** مسار الواجهة `processCostingService.upsertStageCost` يتجاهل خطأ الاستعلامين فيحسب **العمل والأعباء = صفر بصمت**؛ **(ب)** الـRPC `upsert_stage_cost` → `upsert_stage_cost_core` **تفشل صراحةً** بخطأ علاقة غير موجودة (§3.1). وزرا «تطبيق وقت العمل/الأعباء» يفشلان صراحةً. | **عالية (صحة التكلفة)** |
| MS-04 | `work_centers` عليها سياسة RLS للقراءة فقط؛ فإنشاء/تعديل مراكز العمل من نافذة `/manufacturing/workcenters` مرفوض عمليًا. | عالية — يحتاج تحققًا حيًا |
| MS-05 | نموذج مركز العمل يعرض `hourly_rate` فقط من أصل 9 أعمدة معدلات/طاقة، منها `normal_scrap_rate` الذي تقرؤه دالة التكاليف فعلًا. | متوسطة |
| MS-06 | معدل الأعباء الافتراضي 15% **مثبت داخل مكوّن React**، ومعدل الأجر يُدخل يدويًا، ولا يُشتق أيهما من مركز العمل. | متوسطة |
| MS-07 | `manufacturing_stages.wip_gl_account_id` يُخزَّن ويُعرض ولا تقرؤه أي دالة ترحيل؛ الترحيل يستخدم أكواد ثابتة من `gl_event_mappings`. | متوسطة (محاسبة) |
| MS-08 | خرائط أحداث التصنيع زُرعت مرة واحدة (Migration 77) ولا يوجد زرع عند إنشاء مؤسسة جديدة، فإتمام أمر تصنيع بتكلفة يفشل `MAPPING_MISSING` في أي مؤسسة جديدة ولا واجهة لإصلاحه. | متوسطة (Onboarding) |
| MS-09 | طريقة التكلفة: عمود لكل أمر (`weighted_average`/`fifo`) بلا واجهة اختيار ولا افتراضي على مستوى المؤسسة، و`public/config.json` يقول `AVCO` بمفردات مختلفة. | متوسطة |
| MS-10 | أعمدة السحب العكسي (`auto_backflush` افتراضيًا `true`، `backflush_timing`) ما زالت قائمة وخدمتها موجودة، بينما السحب العكسي **متقاعد** منذ 190. | متوسطة (تضليل) |
| MS-11 | `bom_settings`: مكوّن `BOMSettings.tsx` غير مركّب في أي مسار، والجدول RLS للقراءة فقط. | منخفضة |
| MS-12 | `/settings/system` للقراءة فقط (`canSave = false`)، و«المخزن الافتراضي» المحفوظ فيها لا تقرؤه أي نافذة أو RPC. | متوسطة |
| MS-13 | ربط حسابات المخزن (`warehouse_gl_mapping`) يُحفظ عبر دالة `SECURITY INVOKER` على جدول RLS للقراءة فقط. | متوسطة — يحتاج تحققًا حيًا |
| MS-14 | علم `uom_engine_enabled` يحكم كل حركة `stock_ledger_entries` بما فيها صرف مواد التصنيع، ولا يظهر في أي نافذة تصنيع ولا يملك مفتاح تشغيل في الواجهة. | معلوماتية |
| MS-15 | سياسات `work_center_calendars` و`routings` و`routing_operations` تفحص العضوية دون `is_active`. | منخفضة — يحتاج تحققًا حيًا |
| MS-16 | لا توجد سلطة موحدة لإعدادات التصنيع: كل مخزن يستخدم حارسًا مختلفًا (§4). | متوسطة (حوكمة) |
| MS-17 | نافذة الأوامر (W2) تُنشئ الأمر **بإدراج مباشر** في `manufacturing_orders` (لا تمرر مواد، فلا تصل إلى `rpc_create_mo_with_reservation`)، ورقم الأمر يُولَّد في المتصفح (`MO-${Date.now()}`) عند تركه فارغًا. وMigration 195 (مستودع) لا تحجر هذا الكاتب المباشر وحده، بل تسحب أيضًا `rpc_transition_mo_status` (كل انتقالات الحالة العادية في `updateStatus.ts:216`) و`rpc_complete_manufacturing_order` (الإتمام، `updateStatus.ts:56`). فإن طُبقت **تفقد W2 الإنشاء وكل تغيير حالة والإتمام معًا** ما لم تُنشر بدائل ذرية قبلها (منسّق #230). | عالية (تتابع نشر) |
| MS-18 | تقرير «تكلفة الإنتاج» (W9) يستدعي `rpc_cost_of_production_report` التي تقرأ حقلين **غير موجودين** في السجلات: `v_stage.costing_method` (لا عمود `costing_method` في `stage_costs`) و`v_mo.qty_planned` (لا عمود `qty_planned` في `manufacturing_orders`؛ العمود اسمه `quantity`). المتغيران من نوع `RECORD` (Baseline:5212+)، فالمتوقع فشل التقرير وقت التشغيل بـ`42703` (يحتاج تحققًا حيًا). ولا يقرأ التقرير `manufacturing_orders.costing_method` ولا `manufacturing_stages`. | عالية — يحتاج تحققًا حيًا |

**الأثر العملي اليوم:** المستخدم لا يجد مكانًا يضبط فيه سلوك التصنيع؛ وما يمكن ضبطه
(مراكز العمل، المراحل) إمّا ناقص الحقول أو ممنوع الحفظ؛ وما يؤثر محاسبيًا (خرائط القيود)
مكشوف للكتابة المباشرة ولا يظهر في أي شاشة؛ وتكلفة المرحلة المحفوظة من شاشة تكاليف
المراحل تُحسب دون عمل وأعباء دون أي تحذير (بينما مسار الـRPC يفشل صراحةً).

---

## 2) جرد النوافذ (الواجهة)

### 2.1 نوافذ قسم التصنيع في `main`

المصادر: `src/features/manufacturing/index.tsx:91-114` (المسارات)،
`src/config/product-catalog.ts:127-154` (القائمة)، `src/config/route-permissions.ts:142-218`
(مفاتيح الدخول).

| # | المسار | حالة القائمة | مفتاح الدخول | المكوّن | مصدر البيانات الفعلي | الإعدادات التي **يستهلكها** | الإعدادات التي **يحتاجها ولا يقرؤها** |
|---|---|---|---|---|---|---|---|
| W1 | `/overview` | ظاهر | أيٌّ من 5 مفاتيح قراءة | `ManufacturingOverview` | `manufacturing_orders` | — | — |
| W2 | `/orders` | ظاهر | `manufacturing.orders.read` | `ManufacturingOrdersManagement` (`index.tsx:233`) | ⚠️ إنشاء بإدراج مباشر في `manufacturing_orders` عبر `manufacturingOrderService.ts:30` → `manufacturingService.create` **بلا مواد**، فلا يُستدعى `rpc_create_mo_with_reservation` (يُستدعى فقط عند `materials.length > 0`)؛ تغيير الحالة عبر `updateStatus` → `rpc_transition_mo_status` (`updateStatus.ts:216`)، والإتمام → `rpc_complete_manufacturing_order` (`updateStatus.ts:56`)؛ `products`. **المسارات الثلاثة تحجرها 195** (MS-17) | افتراضيات أعمدة الجدول فقط (`costing_method='weighted_average'`، `auto_backflush=true`)؛ رقم أمر يُولَّد في المتصفح | طريقة التكلفة، مخزن المواد الخام، مخزن الإنتاج التام، ترقيم الأوامر من الخادم (MS-17) |
| W3 | `/mes` | beta | `manufacturing.work_centers.read` | `WorkCenterDashboard` | `work_centers` فقط (الهوية والتفعيل: `id, name, name_ar, is_active`). `CAN_READ_WORK_ORDERS` و`CAN_ACT_ON_WORK_ORDERS` مثبتتان على `false` (`WorkCenterDashboard.tsx:50,56`)، فلا يستعلم `useWorkOrders`/`useWorkCenterSummary`، ولا تُنفَّذ أي من أفعال البدء/الإتمام/الإيقاف/الاستئناف (و`start_operation`/`complete_operation` مسحوبتان من العملاء في 195 — مستودع) | — (لا يقرأ معدلات المركز) | سياسة حالات أمر العمل المسموح بالصرف عليها (`material_issue_wo_policies`)، `requires_inspection` |
| W4 | `/routing/*` | **مخفي** (#152) | غير مسجل → يُغلق | `RoutingManagement`، `RoutingForm` | **لا شيء فعليًا:** كل بوابات القراءة والكتابة مثبتة على `false` داخل المكوّنين (`RoutingManagement.tsx:51-56`، `RoutingForm.tsx:33-35`)، والنموذج يستورد `useRouting`/`useCreateRouting`/`useUpdateRouting` فقط ولا يركّب أي hook للعمليات | — | S12 كاملًا (لا محرّر مركّب له)؛ معدلات مركز العمل كقيم أولية |
| W5 | `/capacity` | beta | `manufacturing.work_centers.read` | `CapacityDashboard` | أربعة hooks مركّبة فقط: `useBottlenecks` → `identify_bottlenecks`؛ `useCapacitySummary` → `v_capacity_summary`؛ `useWeeklyScheduleSummary` → `schedule_details` + `work_center_load`؛ `usePredictDelays` → `schedule_details` | طاقة المركز عبر `v_capacity_summary` (Baseline:20008–20029): `capacity_hours_per_day` و`number_of_machines` فقط | التقويم (S11): hooks التقويم والجداول موجودة في `useCapacity.ts` لكنها **غير مركّبة**؛ لا واجهة لضبط ساعات اليوم/عدد الآلات |
| W6 | `/efficiency` | beta | كل من 3 مفاتيح | `EfficiencyDashboard` | `v_oee_report` (عبر `useOEEReport` و`useOverallOEE` و`useDashboardStats`)، `v_labor_efficiency`، `v_work_center_efficiency_summary`، `v_material_consumption_report`، و`v_cost_variance_report` (عبر `useCostVarianceReport` و`useTotalVariances`) — كلها مركّبة دون شرط | **S12 + S4:** `v_cost_variance_report` يحسب تكلفة العمل والأعباء من `routing_operations.labor_rate_per_hour/overhead_rate_per_hour` مع الرجوع إلى `work_centers.default_labor_rate/default_overhead_rate`؛ و`v_oee_report` يحسب الوقت المتاح من `work_centers.capacity_hours_per_day` ودورة الإنتاج المثالية من `routing_operations.standard_run_time_per_unit` (Baseline:20223–20233)؛ أما `v_work_center_efficiency_summary` فلا يقرأ من المركز إلا `id`/`name`/`name_ar` | أعمدة الكفاءة المخزنة (`efficiency_percent`/`efficiency_rate`) لا تقرؤها أي view |
| W7 | `/process-costing` | beta | `manufacturing.stage_costs.read` | `StageCostingPanel` | `stage_costs`، `manufacturing_stages`، `work_centers`، ⛔ `labor_time_logs`، ⛔ `moh_applied` | **ثابت 15% في الكود** (`stage-costing-panel.tsx:713`)، أجر يدوي | `work_centers.hourly_rate/default_labor_rate/default_overhead_rate/normal_scrap_rate` |
| W8 | `/equivalent-units` | beta | `manufacturing.stage_costs.read` | `EquivalentUnitsDashboard` | `manufacturing_stages` (عبر `useManufacturingStages()` المركّب دون شرط → `manufacturingStagesService.getAll()`) — القراءة الحقيقية الوحيدة؛ و🟡 أوامر مثبتة في الكود + خدمة stub للباقي | قائمة المراحل (S5) | طريقة التكلفة (WA/FIFO) |
| W9 | `/cost-of-production` | beta | `manufacturing.stage_costs.read` | `CostOfProductionReport` | `rpc_cost_of_production_report` (⛔ MS-18) | — : لا يقرأ `manufacturing_orders.costing_method` (S7) ولا `manufacturing_stages` (S5)؛ يتفرع على `v_stage.costing_method` وهو حقل غير موجود في `stage_costs` | طريقة التكلفة من الأمر (S7) |
| W10 | `/variance-alerts` | beta | `manufacturing.stage_costs.read` | `VarianceAlerts` | 🟡 بيانات وهمية (`variance-alerts.tsx:47`) | — | عتبات الانحراف (لا مخزن لها أصلًا) |
| W11 | `/stages` | ظاهر | `manufacturing.stages.read` | `ManufacturingStagesList` | `manufacturing_stages` مباشرة | `order_sequence` | `work_center_id` و`wip_gl_account_id` غير موجودين في النموذج |
| W12 | `/wip-log` | beta | `manufacturing.stage_costs.read` | `StageWipLogList` + `WipLogFormDialog` | `stage_wip_log`، `rpc_close_stage_wip_194` | افتراضيات نسب الإتمام (100%) من الجدول | — |
| W13 | `/standard-costs` | beta | `manufacturing.stage_costs.read` | `StandardCostsList` | `standard_costs`، `products` | فترة السريان | — |
| W14 | `/workcenters` | ظاهر | `manufacturing.work_centers.read` | `WorkCentersManagement` (`index.tsx:670`) | ⛔ `insert`/`update` مباشر على `work_centers` | `hourly_rate` فقط | 8 أعمدة معدلات/طاقة (MS-05) |
| W15 | `/bom`، `/bom/new`، `/bom/:bomId/edit` | ظاهر | `manufacturing.boms.read` / `manufacturing.boms.create` / `manufacturing.boms.update` (على التوالي) | `BOMManagement`، `BOMBuilder` | `bom_headers`، `bom_lines`، `products` عبر hooks القائمة/القراءة/الإنشاء/التعديل/الحذف/الاعتماد/النسخ فقط؛ لا يُركّب `useBOMExplosion` ولا `useBOMCost` ولا `bomTreeService` | — | `bom_settings` (المكوّن غير مركّب) |
| W16 | `/quality` | planned | `manufacturing.orders.read` | `QualityControlManagement` (`index.tsx:940`) | لا شيء — «قريبًا» | — | `quality_policies` (199 — مستودع فقط) |

### 2.2 نوافذ خارج قسم التصنيع تحمل إعدادات تؤثر فيه

| النافذة | المخزن | الأثر على التصنيع | الحالة |
|---|---|---|---|
| `/settings/system` (`SystemSettingsPage.tsx`) | `org_settings` بمفتاح `system` | يعرض «المخزن الافتراضي» `defaultWarehouseId` | 🟡 قراءة فقط (`canSave = false`، السطر 37)؛ القيمة **لا يقرؤها أحد** — لا مستهلك في `src/` ولا في أي دالة DB |
| شاشة المخازن (`warehouse-service.ts:515`) | `warehouses.*_account_id` + `warehouse_gl_mapping` | حسابات مخزون المواد والإنتاج | ⛔ يحتاج تحققًا حيًا (MS-13) |
| واجهات الوحدات في المخزون والمشتريات | `org_settings` بمفتاح `uom_engine_enabled` | يقرر هل يُرفض صرف مادة غير مربوطة الوحدة | 🟡 قراءة فقط؛ لا مفتاح تشغيل في الواجهة (`setUomEngineEnabled` بلا مستدعٍ) |
| شجرة الحسابات | `gl_accounts` | الأكواد التي تشير إليها `gl_event_mappings` | ✅ |

### 2.3 صفحات إعدادات مقترحة في مسودات PR مفتوحة (غير مدموجة)

| PR | الصفحة | المسار | المخزن | مفتاح الدخول | ملاحظة |
|---|---|---|---|---|---|
| #292 | `MaterialIssuePolicyPage` | `/manufacturing/material-issue-policy` (مخفي، #229) | `material_issue_wo_policies` (192 — **مطبّقة**) | `manufacturing.material_consumption.consume` | الكتابة نفسها تشترط Org Admin داخل الـRPC |
| #304 | `QualitySettingsPage` | `/settings/quality` + بطاقة في نظرة الإعدادات | `quality_policies` (199 — مستودع فقط) | `manufacturing.quality_inspections.read` | الكتابة تشترط مسؤول المؤسسة داخل الـRPC |

**التعارض:** مسودتان لإعدادات تخص التصنيع، الأولى داخل قسم التصنيع والثانية داخل قسم
الإعدادات العام. دمجهما كما هما يرسّخ تشتت MS-02. القرار المطلوب في §7 (D1).

---

## 3) جرد مخازن الإعدادات (قاعدة البيانات والعميل)

| # | المخزن | النطاق | ماذا يحدد | تكتبه | تقرؤه دوال DB | تقرؤه الواجهة | الحماية الفعلية | الحالة |
|---|---|---|---|---|---|---|---|---|
| S1 | `wardah_internal.material_issue_wo_policies` (M192) | مؤسسة | حالات أمر العمل المسموح بالصرف عليها: `IN_PROGRESS` إلزامي + `READY`/`IN_SETUP` اختياريان | `rpc_set_material_issue_wo_statuses` | `rpc_consume_material_event`، `rpc_get_material_issue_context` (195)؛ **عقد قراءة العميل:** `rpc_get_material_issue_wo_statuses` (192، عضو نشط) | لا شيء في `main` (#292) | Org Admin + تدقيق + نسخة؛ **آخر كاتب يفوز** (لا `expected_version`) | 🟡 DB ✅ / واجهة ❌ |
| S2 | `wardah_internal.quality_policies` (M199) | مؤسسة | بوابة الإفراج، نطاق الفحص، الإفراج المشروط، فصل المهام | `rpc_set_quality_policy` | `evaluate_quality_release_199`، trigger على `manufacturing_orders`؛ **عقد قراءة العميل:** `rpc_get_quality_policy` (199) | لا شيء في `main` (#304) | مسؤول المؤسسة + نسخة | 🟡 مستودع فقط |
| S3 | `gl_event_mappings` (M76/M77) | مؤسسة (+ مركز عمل اختياري) | حسابات قيود `MATERIAL_ISSUE`، `FG_RECEIPT`، `OH_APPLIED` (لكل مركز)، `LABOR_APPLIED`، `NORMAL_SCRAP`، `ABNORMAL_SCRAP`، `OH_UNDER/OVER_APPLIED`، `PROCESS_COST_VARIANCE` | `rpc_upsert_event_mapping` (`service_role` فقط) **أو أي عضو مباشرة** | `rpc_post_event_journal` (Baseline:8470)، `rpc_post_work_center_oh` (Baseline:9452) | لا نافذة تصنيع؛ لكن `fetchCogsAccounts` في `financial-statements-service.ts:126` يقرأ صفوف `COGS_DELIVERY` مباشرة لتقرير الربحية — **قارئ عميل قائم يجب الحفاظ على `SELECT` له** عند أي إغلاق | ⛔ سياسة `ALL` بلا `TO` وفحص مؤسسة فقط (Baseline:29939) + `GRANT ALL` لـ`anon`/`authenticated` (Baseline:35222) | ⛔ MS-01، MS-08 |
| S4 | `work_centers` — أعمدة المعدلات والطاقة | مركز عمل | `hourly_rate`، `default_labor_rate`، `default_overhead_rate`، `normal_scrap_rate`، `capacity_per_hour`، `capacity_hours_per_day`، `number_of_machines`، `efficiency_percent`، `efficiency_rate`، `calendar_id` | الواجهة مباشرة (⛔ RLS) | `upsert_stage_cost_core` (`normal_scrap_rate`)، `v_capacity_summary` (الطاقة وعدد الآلات)، `v_oee_report` (`capacity_hours_per_day`)، `v_cost_variance_report` (المعدلات الافتراضية كرجوع) | W5، W6، W14 (W7 يحتاجها ولا يقرؤها) | سياسة `SELECT` فقط (Baseline:32549) | ⛔ MS-04، MS-05 |
| S5 | `manufacturing_stages` | مرحلة | التسلسل، مركز العمل، **حساب WIP** | الواجهة مباشرة | لا دالة ترحيل تقرأ `wip_gl_account_id` | W7، W8، W11، W12، W13 (لا W9) | `ALL` بفحص المؤسسة فقط | 🟡 MS-07 |
| S6 | `standard_costs` | منتج × مرحلة | التكلفة المعيارية وفترة السريان | الواجهة مباشرة | — | W13 | `ALL` بفحص المؤسسة فقط | ✅ (بلا مفتاح كتابة في DB) |
| S7 | `manufacturing_orders` — أعمدة سلوك لكل أمر | أمر | `costing_method`، `auto_backflush`، `backflush_timing`، `routing_id` | الإنشاء/التحديث المباشر (يُحجر في 195 — مستودع) | `upsert_stage_cost_core` (`costing_method`)؛ **لا** `rpc_cost_of_production_report` (MS-18) | W2 | **Production الآن (بعد 193):** سياسات `SELECT`/`INSERT`/`UPDATE` بشرط `org_id = auth_org_id()` أو `is_super_admin()` (Baseline:30660–30674؛ سياسة الحذف عند 30653 أسقطتها 193) + `GRANT ALL` لـ`anon`/`authenticated`؛ وسحبت 193 `DELETE`/`TRUNCATE` من العملاء وأسقطت سياسة الحذف وأضافت trigger يمنع `TRUNCATE`. **بعد 195 (مستودع):** يُسحب `INSERT`/`UPDATE` من العملاء أيضًا مع 12 RPC قديمة، منها `rpc_transition_mo_status` و`rpc_complete_manufacturing_order` (MS-17) | 🟡 MS-09، MS-10، MS-17 |
| S8 | `bom_settings` | مؤسسة (key/value نصي) | `bom_tree_cache_duration_hours`، `bom_max_levels`، `bom_auto_calculate_cost` | `bomTreeService.updateBOMSettings` (⛔ RLS) | — | لا شيء مركّب | سياسة `SELECT` فقط (Baseline:29568) + `GRANT ALL` لـ`anon` | 🟡 MS-11 |
| S9 | `org_settings` (M98) | مؤسسة (key/value JSONB) | `system` (عرض + مخزن افتراضي)، `uom_engine_enabled` | `setOrgSetting` (Org Admin عبر RLS) | `wardah_guard_mapped_product_uom_stock_write` (Baseline:15962) على `stock_ledger_entries` | `/settings/system`، واجهات الوحدات | Org Admin | 🟡 MS-12، MS-14 |
| S10 | `warehouse_gl_mapping` + أعمدة حسابات `warehouses` | مخزن | حساب المخزون والتسوية والتكلفة | `update_warehouse_gl_mapping` (`SECURITY INVOKER`) | — | شاشة المخازن | سياسة `SELECT` فقط (Baseline:32439) | ⛔ MS-13 |
| S11 | `work_center_calendars` | مركز × يوم | ساعات العمل والعطل والصيانة | خدمة الطاقة مباشرة (hooks غير مركّبة) | `calculate_available_capacity` وأخواتها | لا نافذة مركّبة (W5 لا يقرؤه) | فحص عضوية دون `is_active` (Baseline:32474) | 🟡 MS-15 |
| S12 | `routing_operations` (+ `routings`) | عملية × مسار | `standard_setup_time`، `standard_run_time_per_unit`، `standard_queue_time`، `standard_move_time`، `time_unit`، `labor_rate_per_hour`، `overhead_rate_per_hour`، `operation_type`، حقول التعهيد (`is_outsourced`، `outsource_vendor_id`، `outsource_cost`)، `requires_inspection`، `inspection_instructions` (Baseline:18885) | **لا كاتب مركّب:** CRUD العمليات في `routingService.ts:300–425` وhooks العمليات في `useRouting.ts` غير مستخدمة، وW4 مقفل؛ أي بيانات حالية دخلت خارج الواجهة | `calculate_routing_standard_cost`، `v_cost_variance_report` (المعدلات)؛ `calculate_routing_total_time` (الأزمنة الأربعة، Baseline:1169)؛ `v_oee_report` (`standard_run_time_per_unit`)؛ `evaluate_quality_release_199` (`requires_inspection` في وضع `routing_flagged` — 199 مستودع) | W6 (عبر `v_cost_variance_report`) | فحص عضوية دون `is_active` لكل العمليات (Baseline:31620–31650) | 🟡 MS-15 |
| C1 | `public/config.json` → `COSTING_CONFIG`، `APP_SETTINGS.costing_method` | تطبيق كامل (ثابت) | `default_overhead_rate: 0.15`، `labor_overhead_rate`، `costing_method: "AVCO"` | ملف ثابت | — | **لا مستهلك** (`getCostingConfig` في `src/core/config.js` لا يستدعيه أحد) | — | 🟡 ميت |
| C2 | `public/config.json` → `TABLE_NAMES` | تطبيق كامل | أسماء جداول بينها ⛔ `labor_time_logs`، `moh_applied`، `process_costs`، `stock_moves` | ملف ثابت | — | `src/lib/realtime.ts:137,149` (اشتراك Realtime على جداول غير موجودة) | — | ⛔ MS-03 |

### 3.1 كائنات يشير إليها كود التصنيع وغير موجودة في Production (Baseline cutoff 189)

| الكائن | من يستخدمه | السلوك الناتج |
|---|---|---|
| `labor_time_logs` | `process-costing-service.ts:127` (تطبيق وقت العمل)، `:309` (حساب التكلفة)، `upsert_stage_cost_core` | زر «تطبيق وقت العمل» يفشل صراحةً (`:145` يرمي الخطأ)؛ وفي `upsertStageCost` لا يُفحص `error` لاستعلام القراءة فتصبح **تكلفة العمل = 0** دون تحذير؛ و`upsert_stage_cost_core` تفشل صراحةً (الصف الأخير) |
| `moh_applied` | `process-costing-service.ts:223`، `:322`، `upsert_stage_cost_core` | نفس الشيء للأعباء: الزر يفشل صراحةً (`:240`)، و`upsertStageCost` تحسب **تكلفة الأعباء = 0** دون تحذير، والـRPC تفشل صراحةً |
| `process_costs` | `supabase-service.ts:357,370,388` | أي مستدعٍ يفشل |
| — | `upsert_stage_cost(...)` ممنوحة لـ`authenticated` وتستدعي `upsert_stage_cost_core` | تفشل وقت التشغيل عند الوصول إلى `SELECT … FROM public.labor_time_logs` (الفرع `ELSE` بعد فحص `information_schema`) |

> هذا يمس صلب «محاسبة تكاليف المراحل». لا يُصلَح بإضافة إعداد؛ يحتاج قرارًا: هل مصدر
> العمل والأعباء هو `labor_time_tracking` (موجود، مربوط بأوامر العمل) و`rpc_post_work_center_oh`
> (موجودة، تقرأ `OH_APPLIED`)، أم جداول جديدة؟ القرار D4 في §7.

---

## 4) السلطة: من يحق له تغيير ماذا؟

| المخزن | الحارس الحالي | مفتاح صلاحية مخصص؟ |
|---|---|---|
| S1 سياسة الصرف | `wardah_assert_org_admin` | لا |
| S2 سياسة الجودة | `quality_is_admin_199` | لا (`manufacturing.quality_policy.update` اسم حدث تدقيق، ليس مفتاحًا في الكتالوج) |
| S3 خرائط القيود | RLS بفحص المؤسسة فقط ⛔ | لا |
| S4 مراكز العمل | RLS قراءة فقط (لا كتابة لأحد من العميل) | `manufacturing.work_centers.create/update` موجودة في الكتالوج **لكن الواجهة وحدها تفحصها** |
| S5 المراحل، S6 التكاليف المعيارية | RLS بفحص المؤسسة فقط | `manufacturing.stages.*`، `manufacturing.stage_costs.*` تفحصها الواجهة فقط |
| S8 إعدادات BOM | RLS قراءة فقط | لا |
| S9 `org_settings` | `wardah_is_org_admin` | لا (`settings.organization.read` بديل رؤية فقط) |

مفاتيح التصنيع في الكتالوج اليوم (`001_system_reference_data_20260905_184634.sql`):
`boms.*`، `orders.*`، `stage_costs.*`، `stages.*`، `work_centers.*` (22 مفتاحًا)، ثم
`material_consumption.consume` (190)، و`material_reservation.reserve/release` و
`material_issue_setup.prepare` (196 — مستودع)، و`quality_inspections.read/create/approve_conditional`
(199 — مستودع). **لا يوجد مفتاح لإعدادات التصنيع.**

---

## 5) مصفوفة التقاطع: الإعدادات × النوافذ

● يقرأ/يتأثر فعلًا — ○ يجب أن يتأثر ولا يفعل — ✎ النافذة التي تكتب الإعداد اليوم.

| الإعداد | W2 أوامر | W3 MES | W4 مسارات | W5 طاقة | W6 كفاءة | W7 تكاليف | W8 وحدات مكافئة | W9 تكلفة إنتاج | W11 مراحل | W12 WIP | W13 معيارية | W14 مراكز | W15 BOM | W16 جودة |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 حالات الصرف | | ○ | | | | | | | | ○ | | | | |
| S2 سياسة الجودة | ○ | ○ | | | | | | | | | | | | ○ |
| S3 خرائط القيود | ● (إتمام: `MATERIAL_ISSUE`+`FG_RECEIPT`) | | | | | ○ (أعباء) | | | ○ (حساب WIP) | | | ○ (`OH_APPLIED` لكل مركز) | | |
| S4 معدلات المركز | | | ○ (قيم أولية لمعدلات العملية) | ● (طاقة وآلات عبر `v_capacity_summary`) | ● (طاقة عبر `v_oee_report` + معدلات افتراضية كرجوع عبر `v_cost_variance_report`) | ○ | | | | | ○ | ✎ (أجر فقط) | | |
| S5 المراحل | | | | | | ● | ● | | ✎ | ● | ● | | | ○ (`stages_and_final`) |
| S6 التكاليف المعيارية | | | | | | | | | | | ✎ ● | | | |
| S7 طريقة التكلفة | ○ | | | | | ○ | ○ | ○ (MS-18) | | | | | | |
| S7 السحب العكسي | ● (افتراضي `true` مضلل) | | | | | | | | | | | | | |
| S8 إعدادات BOM | | | | | | | | | | | | | ○ | |
| S9 المخزن الافتراضي | ○ | ○ | | | | | | | | | | | | |
| S9 محرك الوحدات ¹ | | | | | | | | | | | | | | |
| S10 حسابات المخزن | ○ | ○ | | | | | | | | | | | | |
| S12 عمليات المسار | | ○ (`requires_inspection`) | ○ (لا محرّر مركّب) | | ● (`v_cost_variance_report` + `v_oee_report`) | | | | | | | | | ○ (`routing_flagged`) |
| C1 أعباء 15% | | | | | | | | | | | | | | |

¹ علم `uom_engine_enabled` يُقرأ في trigger على كل إدراج في `stock_ledger_entries`، فيحكم
مسار صرف المواد (`rpc_consume_material_event`) — وهذا المسار **لا نافذة له في `main`** بعد
(#229/#292). لا تقرؤه أي من النوافذ W1–W16 مباشرة. ملاحظة جانبية: إغلاق WIP
(`rpc_close_stage_wip_194`) لا يرحّل قيدًا، فلا يتقاطع مع S3.

قاعدة المصفوفة: الخلية ● تعني أن **مكوّنًا مركّبًا** في النافذة يستدعي مسارًا يقرأ الإعداد؛ دوال
الخدمة والـhooks غير المركّبة لا تُحتسب. لذلك: W3 لا يقرأ معدلات المركز (يختار الهوية فقط)؛
W7 (`upsertStageCost`) وW12 (إغلاق WIP) لا يقرآن `costing_method`؛ و`updateBackflushSettings`
في خدمة الكفاءة لا يركّبها W6؛ وW3 لا يقرأ أوامر العمل لأن بوابتيه مثبتتان على `false`؛ وW15 لا يركّب
دوال التفجير والتكلفة والشجرة؛ وW9 لا يقرأ S5 ولا S7 (MS-18)؛ وصف C1 فارغ لأن W7 يكتب `0.15` حرفيًا في
الكود ولا يقرأ `public/config.json` — تطابق الرقم ليس قراءة؛ وW4 لا يقرأ ولا يكتب شيئًا لأن بواباته مثبتة على `false`؛ وW5 لا
يقرأ معدلات المركز لأن `v_capacity_summary` لا يعرضها.

---

## 6) التصميم المقترح لقسم «إعدادات التصنيع»

### 6.1 الموقع

نافذة واحدة **`/manufacturing/settings`** داخل قسم التصنيع، بتبويبات، مع بطاقة اختصار
في `/settings` تحيل إليها. السبب: مستخدم التصنيع يعمل داخل القسم، والإعدادات هنا تشغيلية
ومحاسبية خاصة بالتصنيع لا إعدادات مؤسسة عامة. (البديل `/settings/manufacturing` مقبول
بشرط أن يكون **بيتًا واحدًا** لا صفحتين.)

### 6.2 التبويبات وما يربط كل تبويب

| التبويب | المحتوى | المخزن | يحتاج DB PR أولًا؟ |
|---|---|---|---|
| عام | طريقة التكلفة الافتراضية للأوامر الجديدة، مخزن المواد الخام الافتراضي، مخزن الإنتاج التام الافتراضي، ترقيم الأوامر | جدول سياسة جديد على نمط S1/S2 (`wardah_internal.manufacturing_policies`) — لا `org_settings` لأنه بلا حارس دلالي | نعم |
| مراكز العمل والمعدلات | كل أعمدة S4 بأسماء موحّدة، مع قرار في الأعمدة المكررة (`hourly_rate` مقابل `default_labor_rate`، `efficiency_percent` مقابل `efficiency_rate`) | S4 + RPC كتابة ذرية بمفتاح `manufacturing.work_centers.update` | نعم (MS-04) |
| المراحل وحسابات WIP | التسلسل، مركز العمل، حساب WIP لكل مرحلة | S5 | لا للعرض؛ نعم لجعل الترحيل يحترم `wip_gl_account_id` |
| ربط القيود المحاسبية | جدول أحداث التصنيع ← حساب مدين/دائن، مع تجاوز لكل مركز عمل لـ`OH_APPLIED`؛ تحذير صريح عند أي حدث بلا خريطة | S3 + RPC كتابة بحارس | **نعم، وهو الأولوية** (MS-01، MS-08) |
| صرف المواد | حالات أمر العمل المسموح بالصرف عليها | S1 (موجود) | لا — مكوّن #292 ينتقل إلى هنا |
| الجودة | سياسة الإفراج والفحص | S2 | 195–199 تُطبّق أولًا — مكوّن #304 ينتقل إلى هنا |
| قوائم المواد | عمق الشجرة، مدة الكاش، الحساب التلقائي | S8 + سياسة كتابة | نعم (MS-11) |
| الحالة (قراءة فقط) | علم محرك الوحدات (`rpc_get_org_uom_engine_enabled`)، الأحداث بلا خرائط، المراكز بلا معدلات، المراحل بلا حساب WIP — كلها قابلة للقراءة اليوم من العميل عبر RLS أو RPC قائمة | قراءات فقط | لا |
| حالة الترحيلات (اختياري) | المهاجرات المطبقة على البيئة | **لا يوجد مصدر قراءة للمتصفح:** `supabase_migrations.schema_migrations` تُقرأ اليوم بأدوات تشغيلية فقط (`Audit Production Migration Ledger`) | **نعم** — عقد قراءة ضيق ومحروس (مثلًا لمسؤول المؤسسة فقط) قبل أي واجهة؛ أو يُستبعد من النطاق |

### 6.3 مفاتيح الصلاحية المقترحة

`manufacturing.settings.read` و`manufacturing.settings.update`، تُضاف في Migration مستقلة،
**وتُستثنى من توسيع القوالب بالـwildcard** كما فُعل مع مفاتيح الجودة في 199. كل RPC كتابة
يفحص المفتاح نفسه داخل قاعدة البيانات، لا الواجهة وحدها. قرار هل يتجاوزها Org Admin هو
D3 في §7.

### 6.4 التسلسل المقترح (يلتزم `repository-first` ثم `DB-first`)

1. **مرحلة 0 — واجهة فقط، بلا DB:** تبويب «الحالة» للقراءة فقط + روابط للنوافذ الحالية،
   مقتصرًا على ما له مصدر قراءة قائم للعميل (علم الوحدات، الخرائط الناقصة، المراكز
   والمراحل الناقصة). **لا يشمل حالة الترحيلات** لعدم وجود عقد قراءة لها؛ إن طُلبت
   فمكانها DB PR يسبق الواجهة. بهذا القيد لا تعتمد المرحلة على أي كائن غير موجود ويمكن
   دمجها مباشرة.
2. **مرحلة 1 — DB PR أول (احتواء):** إغلاق الكتابة المباشرة على `gl_event_mappings`
   وسحب `anon`، مع RPC كتابة محروسة ومدققة. **يُبقي `SELECT` للأعضاء** لأن
   `fetchCogsAccounts` (تقرير الربحية) يقرأ الجدول مباشرة اليوم. Additive فقط، لا حذف بيانات.
3. **مرحلة 2 — DB PR ثانٍ:** مفاتيح `manufacturing.settings.*`، RPC كتابة لمراكز العمل،
   جدول السياسة العامة مع زرع لكل مؤسسة وtrigger عند الإنشاء، زرع خرائط القيود للمؤسسات الجديدة،
   وسياسة/RPC كتابة لـ`bom_settings` (S8). أي بند لا يدخل هذا الـPR ينتقل إلى DB PR لاحق
   يُدمج ويُطبَّق قبل التبويب الذي يعتمد عليه.
4. **مرحلة 3 — UI PR:** التبويبات القابلة للتعديل، **بعد** تطبيق مرحلتي 1–2 على Production
   والتحقق منهما. **القاعدة العامة:** كل تبويب علّمه §6.2 بـ«نعم» في عمود «يحتاج DB PR أولًا»
   لا يُدمج حتى يُدمج تغييره في قاعدة البيانات ويُطبَّق على Production ويُتحقق منه؛ وإلا يُؤجَّل.
   شروط إضافية لكل تبويب:
   - **قوائم المواد:** يعتمد على سياسة/RPC الكتابة لـS8؛ إن لم تدخل مرحلة 2 يُؤجَّل.
   - **الجودة:** لا يُدمج قبل تطبيق سلسلة **195 → 199** على Production والتحقق منها، لأن
     `quality_policies` و`rpc_get_quality_policy` موجودتان في 199 فقط. حتى ذلك الحين يُؤجَّل
     التبويب، أو يبقى PR الواجهة غير مدموج.
   - **صرف المواد:** يعتمد على S1 و`rpc_get/set_material_issue_wo_statuses` المطبّقتين (192)، فلا
     ينتظر 195–199.
   - أي تبويب أو نافذة تحفظ عبر مسار تحجره 195 — في W2: الإنشاء المباشر، و`rpc_transition_mo_status`،
     و`rpc_complete_manufacturing_order` (MS-17) — يُنقل إلى بدائل ذرية تُنشر **قبل** تطبيق 195.
5. **مرحلة 4 — مصدر العمل والأعباء (MS-03):** حسب قرار D4، ثم إزالة القيمة الثابتة 15% من
   `StageCostingPanel` واشتقاقها من مركز العمل.
6. **تنظيف لا حذف:** تعليم `COSTING_CONFIG` و`TABLE_NAMES` الميتة كمهجورة، وإخفاء خيارات
   السحب العكسي من أي واجهة. الأعمدة والجداول تبقى (القاعدة الذهبية).

---

## 7) قرارات مطلوبة من الفريق

| # | القرار | الخيارات |
|---|---|---|
| D1 | بيت إعدادات التصنيع | `/manufacturing/settings` (موصى به) أو `/settings/manufacturing`؛ ومصير صفحتي #292 و#304 |
| D2 | خرائط القيود للمؤسسات الجديدة | زرع افتراضي من شجرة حسابات قالبية، أو منع الإتمام برسالة توجّه للإعدادات |
| D3 | تجاوز Org Admin لمفاتيح الإعدادات | يتجاوز (كالمفاتيح العادية) أم منح صريح (كالمفاتيح الحساسة في 174) |
| D4 | مصدر تكلفة العمل والأعباء في المرحلة | `labor_time_tracking` + `OH_APPLIED` الموجودان، أم جداول جديدة، أم إدخال يدوي مدقق |
| D5 | الأعمدة المكررة في `work_centers` | أيها القانوني، ومتى يُتوقف عن قراءة الآخر |
| D6 | هل يحترم الترحيل `manufacturing_stages.wip_gl_account_id` | نعم (WIP لكل مرحلة) أم حساب WIP موحد من خرائط القيود |
| D7 | طريقة التكلفة | افتراضي على مستوى المؤسسة مع تجاوز لكل أمر، أم ثابت للمؤسسة |

---

## 8) إعادة التحقق

### 8.1 من المستودع (قابل للتكرار)

```bash
# لا مسار إعدادات للتصنيع
grep -n 'path="settings' src/features/manufacturing/index.tsx            # لا نتيجة
# المخزن الافتراضي بلا مستهلك
grep -rn defaultWarehouseId src --include=*.ts --include=*.tsx | grep -v __tests__
# جداول مفقودة
B=sql/baseline/000_schema_baseline_20260905_184634.sql
grep -cE '^CREATE TABLE public\.(labor_time_logs|moh_applied|process_costs) ' $B   # 0
# سياسات القراءة فقط
grep -E '^CREATE POLICY [a-z_]+ ON public\.(work_centers|bom_settings|warehouse_gl_mapping) ' $B
# كشف خرائط القيود
grep -A1 '^CREATE POLICY gl_event_mappings_org_isolation' $B
grep '^GRANT ALL ON TABLE public.gl_event_mappings' $B
```

### 8.2 من Production — قراءة فقط (لم تُنفَّذ في هذا الجرد)

تُنفَّذ داخل `BEGIN READ ONLY; … ROLLBACK;` وتُرجع أعدادًا وأسماء كتالوج فقط:

```sql
-- MS-03: هل الجداول موجودة حيًا؟
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('labor_time_logs','moh_applied','process_costs');

-- MS-01 / MS-04 / MS-11 / MS-13 / MS-15: السياسات والمنح الحية
SELECT tablename, policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('gl_event_mappings','work_centers','bom_settings',
                    'warehouse_gl_mapping','work_center_calendars')
ORDER BY 1, 2;
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('gl_event_mappings','work_centers','bom_settings','warehouse_gl_mapping')
  AND grantee IN ('anon','authenticated')
GROUP BY 1, 2 ORDER BY 1, 2;

-- MS-08: المؤسسات التي ينقصها حدث تصنيع
SELECT e.event_code, count(*) FILTER (WHERE m.id IS NULL) AS orgs_missing
FROM public.organizations o
CROSS JOIN (VALUES ('MATERIAL_ISSUE'),('FG_RECEIPT'),('OH_APPLIED')) e(event_code)
LEFT JOIN public.gl_event_mappings m
  ON m.org_id = o.id AND m.event_code = e.event_code AND m.is_active
GROUP BY 1 ORDER BY 1;

-- MS-05 / MS-07: اكتمال إعدادات المراكز والمراحل (أعداد فقط)
SELECT count(*) AS work_centers,
       count(*) FILTER (WHERE COALESCE(hourly_rate,0) = 0) AS no_rate,
       count(*) FILTER (WHERE COALESCE(default_overhead_rate,0) = 0) AS no_overhead
FROM public.work_centers;
SELECT count(*) AS stages,
       count(*) FILTER (WHERE wip_gl_account_id IS NULL) AS no_wip_account,
       count(*) FILTER (WHERE work_center_id IS NULL) AS no_work_center
FROM public.manufacturing_stages;
```

الاختبار السلبي لـMS-01 وMS-04 (محاولة كتابة كعضو عادي) **لا يُنفَّذ على Production**؛
مكانه Fresh DB أو بيئة Supabase معزولة وفق سياسة البيئات في `CLAUDE.md`.

---

## 9) مراجع

- [`MANUFACTURING_QUALITY_CONTROL_INVENTORY_20261002.md`](./MANUFACTURING_QUALITY_CONTROL_INVENTORY_20261002.md) — جرد الجودة الذي أنتج S2.
- [`MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md`](./MANUFACTURING_INVENTORY_RECONCILIATION_20260925.md) — نتائج #229/#230/#234 (الإتمام دون مخزن/bin، والسحب العكسي المتقاعد).
- [`../db/MATERIAL_ISSUE_CLIENT_229_CONTRACT.md`](../db/MATERIAL_ISSUE_CLIENT_229_CONTRACT.md) — عقد واجهة سياسة الصرف (S1).
- [`../db/MANUFACTURING_QUALITY_CONTROL_199_RUNBOOK.md`](../db/MANUFACTURING_QUALITY_CONTROL_199_RUNBOOK.md) — سياسة الجودة (S2).
- `sql/migrations/77_seed_gl_event_mappings.sql` — الزرع الوحيد لخرائط أحداث التصنيع.
- Issues ذات صلة: #152 (routing)، #154 (صلاحيات MES)، #170، #229، #230، #234، #278.
