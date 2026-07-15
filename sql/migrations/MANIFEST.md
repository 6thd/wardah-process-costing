# دليل الـ Migrations القانوني — Wardah ERP

> **القاعدة**: عند بناء بيئة جديدة طبّق الملفات بالترتيب الرقمي.
> عند وجود نسخ متعددة لنفس الرقم، هذا الدليل يحدد **القانونية** منها.
> النسخ المتجاوزة تبقى في المستودع للتاريخ — لا تُحذف ولا تُطبَّق.

## الجوهر المطبَّق على قاعدة البيانات الحية ✅

| Migration | الغرض | الحالة |
|---|---|---|
| 66-69 | WIP fields + EUP متوسط مرجّح + Scrap + FIFO | ✅ مطبَّقة |
| 76 | القيد الذرّي `rpc_create_journal_entry` + بوابة الأحداث + `wardah_org_id` | ✅ مطبَّقة |
| 77 | زرع خرائط الأحداث المحاسبية | ✅ مطبَّقة |
| 78 | آلة حالات MO + الحجز الذرّي | ✅ مطبَّقة |
| 79 | فرض إقفال الفترات + إدارتها | ✅ مطبَّقة |
| 80 | تقرير تكلفة الإنتاج (EUP) | ✅ مطبَّقة |
| 81 | تسوية الدفاتر الفرعية مع GL | ✅ مطبَّقة |
| 82 | أمني: إزالة execute_sql | ✅ مطبَّقة (10 يوليو 2026) — كانت غائبة أصلاً |
| 83 | أمني: عزل المؤسسات RLS (rollback في `sql/rollback/`) | ✅ مطبَّقة — أُتمّت بـ 86 |
| 84 | قيد GL للاستلام (GRNI 210150) | ✅ مطبَّقة — GR_RECEIPT: مدين 131100/دائن 210150 |
| 85 | إذن التسليم الذرّي `rpc_post_delivery_note` + COGS | ✅ منشورة — ⚠️ راجع «تعارض بنيوي» أدناه |
| **86** | **أمني: إغلاق ثغرات anon على الدفتر المالي (متمّم لـ 83)** | ✅ مطبَّقة — الملف يعيد إنتاجها |
| **87** | **مواءمة دالة التسليم الذرّي مع المخطط الحيّ (products/org_id)** | ✅ مطبَّقة + مُختبرة حيّاً |
| **88** | **تحصين التسليم: عضوية+عزل org+ملكية+منع تسليم زائد+idempotency+COGS fail-closed** | ✅ مطبَّقة + 9 اختبارات rollback |
| **89** | **استلام بضاعة ذرّي (رأس+سطور+GRNI) fail-closed + idempotency** | ✅ مطبَّقة + 5 اختبارات rollback |
| **90** | **تشديد الاستلام: مورد/سطر PO/مخزن/تجاوز/سالب + PO ذرّي + سباق idempotency** | ✅ مطبَّقة + 9 اختبارات rollback |
| **91** | **التسليم: إصلاح سباق idempotency + بوابة admin للتسليم الزائد** | ✅ مطبَّقة + مُختبرة حيّاً |
| **92** | **إصلاح تعارض مخطط آلة حالات التصنيع (mo_number→order_number إلخ) + عضوية** | ✅ مطبَّقة + مُختبرة حيّاً |
| **93** | **إتمام أمر تصنيع ذرّي: مخزون تام (متوسط مرجّح) + سلسلة قيود Raw→WIP→FG (Fail-closed) + idempotent** | ✅ مطبَّقة + مُختبرة حيّاً بالكامل (PART 1: مخزون تام+done+replay؛ PART 2: total_cost + قيدا MATERIAL_ISSUE/FG_RECEIPT + **WIP 134100 يصفو=0**) |
| **94** | **إغلاق ذرّية المخزون: SLE + bins + تقييم (FIFO/LIFO/متوسط) داخل rpc_post_goods_receipt** | ✅ مطبَّقة + مُختبرة حيّاً (WA/FIFO/LIFO مطابِقة للمحرّك + GRNI متزن + idempotent + إصلاح علة bin فارغ) |
| **95** | **إغلاق مراجعة Codex: replay يعيد inventory_atomic (منع تكرار مخزون) + سحب صلاحية الدالة المساعدة (أمني) + تشديد المورد/المخزن/PO + إتمام تكلفة صفرية Fail-closed** | ✅ مطبَّقة + مُختبرة حيّاً (replay=SLE واحد، الدالة المساعدة غير متاحة لـ authenticated، رفض مورد/PO/مخزن، ZERO_COST_COMPLETION) |
| **96** | **بوابة admin لـ allow_zero_cost + بصمة الحمولة (request_hash) على idempotency الاستلام** | ✅ مطبَّقة + مُختبرة حيّاً (نفس المفتاح بحمولة مختلفة=IDEMPOTENCY_KEY_REUSED، allow_zero_cost لغير المدير يُخفَّض) |
| **97** | **توحيد المخزون: products مجمّع مرجعي مشتق من bins (الخيار B) — مزامنة products.stock_quantity/cost_price داخل wardah_apply_stock_incoming + تسوية idempotent للـ bins السابقة** | ✅ مطبَّقة + مُختبرة حيّاً (تسوية: products=001(18,200 تام)+RM-042(3,250 خام)=**21,450**؛ استلام 100@8 فوق 500@6.5 ⇒ bins=products=600@6.75، اشتقاق idempotent بلا مضاعفة) |
| **98** | **جدول org_settings (key/value JSONB لكل مؤسسة) + RLS قياسي + trigger updated_at — خلفية شاشة إعدادات النظام والنسخ الاحتياطي (P11-6)** | ✅ مطبَّقة + مُختبرة حيّاً (upsert مرتين على نفس المفتاح ⇒ صف واحد بالقيمة الأحدث، rollback) |
| **99** | **تأسيس HR الشرعي (P12-A): سياسات RLS عاملة (wardah_org_id) للجداول الثمانية المقفلة فعلياً (سياستها القديمة تعتمد app.current_org_id الذي لا يضبطه عميل Supabase) + تحصين upsert_attendance_day (عضوية + موظف نفس المؤسسة + رفض شهر مقفل) + تفرّد/idempotency على payroll_runs + توسيع أنواع حسابات الرواتب (GOSI/نهاية خدمة/إضافي) + سياسات GOSI والمعدل اليومي والإضافي واستحقاق الإجازات في hr_policies + employees.is_saudi/contract_end_date. ملاحظة: جداول HR التاريخية (15_hr_module + sql/hr/16 + sql/hr/17) تأكد وجودها حيّاً واستُوعبت قانونياً هنا** | ✅ مطبَّقة + مُختبرة حيّاً (بلا JWT⇒NOT_ORG_MEMBER، عضو⇒upsert يوم يدمج JSONB، شهر مقفل⇒PAYROLL_MONTH_LOCKED، 8 سياسات جديدة، rollback) |
| **112** | **إصلاح pgcrypto المفقودة في دوال الدعوات**: استبدال `digest(x,'sha256')` من pgcrypto (غير مثبَّتة) بـ`sha256(x::bytea)` المدمجة في PostgreSQL 11+؛ الدوال المُصلَحة: `fn_invitations_set_token_hash` + `rpc_accept_invitation` + `rpc_get_invitation_preview`؛ إعادة حساب `token_hash` للصفوف القائمة. النتيجة: كل INSERT/UPDATE على `invitations` يعمل بلا pgcrypto + `rpc_get_invitation_preview` تحافظ على توقيع TABLE الفعلي | ✅ مطبَّقة (يوليو 2026) |
| **111** | **تثبيت search_path لدوال انحرافات التصنيع**: إعادة إنشاء `calculate_material_variances` + `calculate_labor_variances` مع `SET search_path = public` لإغلاق تحذيري `function_search_path_mutable` في Supabase Security Advisor | ✅ مطبَّقة (يوليو 2026) |
| **110** | **تطبيع حالات أوامر التصنيع + التحقق من القيد**: تحويل صفوف بصيغة hyphen قديمة (`in-progress`→`in_progress`، `quality-check`→`quality_check`، `on-hold`→`on_hold`)؛ ثم `VALIDATE CONSTRAINT manufacturing_orders_status_check` (كان NOT VALID) | ✅ مطبَّقة (يوليو 2026) |
| **109** | **عرض WIP حسب مراحل التصنيع** (`wip_by_stage`، security_invoker): نُقل من `src/database/migrations/002_create_wip_view.sql`؛ **أُعيد كتابته** ليستخدم الجداول الموجودة فعلاً (`manufacturing_orders`+`products`+`work_orders`) بدل `stock_moves`/`labor_entries`/`overhead_allocations` الغائبة عن الإنتاج | ✅ مطبَّقة (يوليو 2026) |
| **108** | **دوال انحرافات التصنيع** (`calculate_material_variances`/`calculate_labor_variances`): نُقلت من `src/database/migrations/001_create_variance_functions.sql`؛ ملاحظة: تستند إلى `stock_moves`/`labor_entries` الغائبتين — ستُعيد خطأ عند التنفيذ حتى تُضاف تلك الجداول؛ search_path مُثبَّت في migration 111 | ✅ مطبَّقة (يوليو 2026) |
| **107** | **P4 — فهرسة 108 مفتاح أجنبي بلا فهارس**: CREATE INDEX IF NOT EXISTS على كل الـ FKs المُبلَّغ عنها من Supabase Advisor "unindexed_foreign_keys"؛ تغطّي: GL/المحاسبة (journal_id/reversed_by/profit_center/segment)، HR والرواتب (payroll_details/settlements/locks/runs + فهارس مركّبة للـFKs من migration 101: attendance/employee_leaves/salary_structures/hr_settlements employee_id+org_id)، التصنيع (work_orders/material_consumption/machine_downtime/quality_inspections/scheduling_constraints/routings/stage_wip_log)، المشتريات/المبيعات (supplier_invoices/goods_receipt_lines/payment_vouchers/receipt_vouchers/customer_collections)، المخزون (stock_adjustments/physical_count/storage_locations/bins)، warehouse_gl_mapping، الأدوار/المستخدمون. **لا تأثير على RLS أو الصلاحيات — إضافة فهارس بحتة** | ✅ مطبَّقة + مُختبرة حيّاً (14/14 فهرس أساسي مُتحقَّق منه، IF NOT EXISTS يضمن idempotency) |
| **106** | **P1 — سحب EXECUTE من PUBLIC على دوال SECURITY DEFINER**: migration 105 سحب من anon مباشرةً لكن المنحة الفعلية كانت عبر PUBLIC (=X/postgres الافتراضية في PostgreSQL)؛ هذا الـ migration يسحب PUBLIC عن كل دالة SECURITY DEFINER في public (ما عدا rpc_get_invitation_preview) — authenticated وservice_role لهما منح صريحة مستقلة لا تتأثر ⇒ صفر دوال DEFINER مكشوفة لـ anon | ✅ مطبَّقة + مُختبرة حيّاً (0 دالة DEFINER متاحة لـ anon بعد التطبيق؛ rpc_get_invitation_preview: anon=✅ auth=✅) |
| **105** | **P1 — تعطيل pg_graphql وسحب EXECUTE من anon على دوال SECURITY DEFINER**: DROP EXTENSION pg_graphql (التطبيق REST فقط) يُلغي 295 تحذير Advisor (144 anon + 151 authenticated table exposed)؛ DO block يسحب EXECUTE من anon مباشرةً على كل دوال SECURITY DEFINER في public ما عدا rpc_get_invitation_preview | ✅ مطبَّقة + مُختبرة حيّاً (438 تحذير → 143 بعد التطبيق) |
| **104** | **P1 تكملة — تضييق منح anon وإصلاح سياسات USING(true) وtoken_hash**: سحب EXECUTE من anon على `rpc_set_org_admin`/`rpc_accept_invitation`/`rpc_create_journal_entry`/`wardah_is_org_admin`؛ سحب ALL من anon على 7 جداول مالية/إدارية حساسة (gl_entries/gl_entry_lines/user_organizations/user_roles/roles/role_permissions/invitations)؛ إصلاح `audit_logs.audit_insert` (WITH CHECK(true)→user_id=auth.uid())؛ إصلاح سياسات USING(true) على جدولَي backup (_20250905_1900)؛ إضافة عمود `token_hash` (SHA-256 محسوب بـ pgcrypto + trigger تلقائي) + فهرس فريد؛ تحديث `rpc_accept_invitation` و`rpc_get_invitation_preview` للبحث بالهاش بدل التوكن الخام — كشف التوكن الخام من جدول invitations لم يعد يُعطي قيمة لمهاجم | ✅ مطبَّقة + مُختبرة حيّاً (7/7 فحوصات نجحت: صفر EXECUTE لـanon على RPCs؛ صفر منح anon على الجداول؛ token_hash=3/3 ممتلئ؛ 3 سياسات backup مُصلحة) |
| **103** | **P0 — إغلاق الفجوات الأمنية المتبقية (Migration 103)**: حذف 12 سياسة USING(true) على جداول مالية (كانت تتجاوز العزل الذي أضافته 83 لأن PostgreSQL يُقيّم RLS بـOR)؛ حذف `user_orgs_update_own` (ثغرة تصعيد `is_org_admin`) واستبدالها بـ`rpc_set_org_admin` (SECURITY DEFINER + بوابة `wardah_is_org_admin` + حارس آخر مدير)؛ حذف `invitations_by_token USING(true)` + RPC آمنة `rpc_get_invitation_preview` (قابلة للاستدعاء من anon، لا تُكشف توكنات) + `rpc_accept_invitation` (تشتق userId من auth.uid() لا من العميل، FOR UPDATE، فحص بريد)؛ تحويل 10 Views إلى security_invoker + إزالة JOIN على auth.users من v_work_order_status؛ تثبيت search_path لـ23 دالة؛ تفعيل RLS على test_init؛ سحب EXECUTE من anon/PUBLIC للدوال الداخلية. TypeScript: checkIsOrgAdmin fail-closed عبر RPC، setUserAsOrgAdmin عبر rpc_set_org_admin، acceptInvitation بلا userId، حارس Org Admin fail-closed، حذف DEFAULT_ORG_ID fallbacks، signup.tsx تستخدم RPC للمعاينة | ✅ مطبَّقة + مُختبرة حيّاً (7 فحوصات نجحت: صفر USING(true) + صفر user_orgs_update_own + صفر invitations_by_token + 3 RPCs موجودة + 10 views security_invoker=on) |
| **102** | **مرحلة مراجعة التسوية + snapshot/hash + حراس الإنهاء (P13-C)**: إصلاح علّة E7 (الواجهة كانت تكتب نوع الإنهاء في settlement_type فلا يطابق شرط قلب الموظف terminated ⇒ الإنهاء لم يكن يحدث للتسويات المنشأة من الواجهة — عمود termination_type مستقل + ترحيل بيانات)؛ دورة draft→review→approved: `rpc_submit_settlement_review` يجمّد snapshot/hash خادمياً من الصف والسطور، والاعتماد يرفض غير المراجَعة (SETTLEMENT_NOT_REVIEWED) ويعيد حساب الـhash (SETTLEMENT_CHANGED_AFTER_REVIEW)؛ بصمة حمولة request_hash على idempotency التسوية (كانت بالمفتاح والحالة فقط)؛ حراس الإنهاء: EMPLOYEE_NOT_ACTIVE/EOS_ALREADY_SETTLED/SETTLEMENT_INVALID_PERIOD/SETTLEMENT_AFTER_LOCKED_PAYROLL؛ FKs مركبة NOT VALID على attendance_records/employee_leaves/employee_salary_structures/hr_settlements؛ CHECK على salary_components.percentage_base (basic\|basic_housing). قرار موثق: المراجِع قد يكون المعتمِد (مرحلة تأكيد لا four-eyes). **مختبرة سلوكياً محلياً (10 اختبارات C1–C10 تمر)** | ✅ مطبَّقة + مُختبرة حيّاً (review_fn_exists=true، snapshot_open_to_anon=false، 6 أعمدة جديدة على hr_settlements، FKs مركبة مُتحقَّق منها) |
| **101** | **RBAC الرواتب + سرية القراءة + عقد الحمولة v2 (P13-A، إغلاق مراجعة كودكس)**: إعادة سحب صلاحية `wardah_apply_stock_incoming` (كانت 97 أعادت فتحها — P0)؛ `wardah_is_org_admin` (نمط بوابة 96) قبل مسار replay في `rpc_post_payroll_run`/`rpc_post_settlement`؛ عقد payload_version=2 (الإجماليات والـbuckets تُشتق من السطور وتُطابق — TOTALS_MISMATCH/BUCKETS_MISMATCH/INVALID_LINE/EMPLOYEE_ORG_MISMATCH)؛ `UNIQUE employees(id,org_id)` + FK مركب NOT VALID على payroll_details مع تقرير الصفوف المخالفة؛ إعادة بناء RLS: قراءة جداول المبالغ الفردية (هياكل/مسيرات/قسائم/حضور/إجازات) وكتابة الثمانية كلها + org_settings خلف البوابة الإدارية. **يتطلب نشر الواجهة المرافقة (عقد v2 + إصلاح ازدواج ADJ_OVERTIME) — النسخ الأقدم تُرفض بـ PAYLOAD_VERSION_UNSUPPORTED**. اختبار آلي: `scripts/security/test_payroll_rbac.sql`؛ سجل التحقق: `docs/security/PAYROLL_SECURITY_LOG.md` | ✅ مطبَّقة + مُختبرة حيّاً (8/8 فحوصات: دوال موجودة، wardah_apply_stock_incoming مغلقة، 0 سياسة HR بلا بوابة، 4 FKs مركبة) |
| **100** | **مسير رواتب وتسوية نهاية خدمة ذرّيان (P12-B): rpc_post_payroll_run (عضوية + قفل استشاري + idempotency ببصمة + سطور payroll_details + قيد متزن عبر rpc_create_journal_entry بحسابات hr_payroll_account_mappings + قفل الشهر) وrpc_post_settlement (FOR UPDATE + idempotency + قيد eos_expense/eos_payable + قلب الموظف terminated). كان الترحيل client-side مباشراً متجاوزاً القناة القانونية وبلا سطور قسائم** | ✅ مطبَّقة + مُختبرة حيّاً (مسير: bal=0.00 و4 سطور GL وdetails=2 وreplay=نفس run وIDEMPOTENCY_KEY_REUSED وPAYROLL_MONTH_LOCKED وUNBALANCED_PAYROLL؛ تسوية: قيد سطرين وemployee=terminated وreplay وSETTLEMENT_NOT_POSTABLE — كله rollback) |

> **COGS_DELIVERY** زُرعت يدوياً بالحسابين الفعليين: مدين **544000** (COGS أكياس
> مطبوعة) / دائن **135100** (FG أكياس مطبوعة) — الافتراضي `511100` في ملف 85 غير
> موجود في شجرة الحسابات الحية. التحقق العملي: قراءة `gl_entries`/`products`
> بمفتاح anon بعد 83+86 ⇒ **0 صف** (كانت تكشف كل البيانات).

## حسم النسخ المتعددة (القانونية بالخط العريض)

| الرقم | النسخ | القانونية |
|---|---|---|
| 12 | `12_create_default_journals` / `12_simple_journals` / 12a-12f | **12_create_default_journals** ثم **12f** للسياسات (لاحقاً استُبدلت 12f بـ **83**) — البقية سكربتات تشخيص لمرة واحدة |
| 14 | `14_backup_checklist` / `_auto_detect` / `_fixed` | **14_backup_checklist_fixed** |
| 15 | `15_process_costing_enhancement` / `_no_migration` | **15_process_costing_enhancement** — `_no_migration` بديل يدوي قديم |
| 65 | `65_fix_stage_costs_complete` / `_v2` | **65_fix_stage_costs_complete_v2** |
| warehouse | `warehouse_accounting_integration` / `_fixed` / `_manual` | **warehouse_accounting_fixed** |
| warehouse mgmt | `warehouse_management_system` / `_fixed` | **warehouse_management_system_fixed** |
| غير مرقّمة | `phase2_stock_ledger_system`, `phase3_valuation_methods`, `migration_add_warehouse_to_goods_receipts`, `fix_view_org_id_error` | تُطبَّق بعد 30 وقبل 50 (نظام المستودعات) — مطبَّقة تاريخياً |

## اتفاقية المسار الوحيد (توحيد Phase 2)

**القاعدة**: كل DDL = ملف مرقّم في هذا المجلد + سطر في هذا الدليل.

| المجلد | الدور |
|---|---|
| `sql/migrations/` | ✅ **المصدر الوحيد** — كل الـ migrations الجديدة هنا |
| `sql/archive/supabase-2024-originals/` | 4 ملفات 2024 أصلية (مؤرشَفة، لا تُطبَّق) |
| `supabase/migrations/` | فارغ + README — Supabase CLI يقرأ `sql/migrations/` عبر MCP |
| `src/database/migrations/` | فارغ — نُقل 001/002 إلى 108/109 هنا |
| `src/migrations/` | TypeScript runner قديم — ليس SQL |

**عند إنشاء migration جديدة**:
1. `sql/migrations/NNN_description.sql` (NNN = الرقم التالي في هذا الملف)
2. سطر جديد في جدول «الجوهر المطبَّق» أعلاه
3. تطبيق عبر `mcp__Supabase__apply_migration` (staging أولاً ثم إنتاج)

## ملاحظات معمارية مهمة

1. **ثلاثة مخططات GL تاريخية**: `gl_entries/gl_entry_lines` (القانوني — يكتب عبر
   `rpc_create_journal_entry` فقط منذ P4-B2)، و`journal_entries/journal_entry_lines`
   (يستخدمه stock-adjustment-service فقط — موثَّق، توحيده مؤجل).
2. **rollback scripts**: تحت `sql/rollback/` — حالياً `83_rollback_org_scoped_rls.sql`.
3. **أرقام جديدة**: التالي هو **113**. أي migration جديدة = ملف جديد مرقّم + سطر هنا.
   — 108: `calculate_material_variances` / `calculate_labor_variances` (دوال انحرافات).
   — 109: `wip_by_stage` view (security_invoker؛ معاد كتابتها باستخدام الجداول المتوفرة فعلاً).
   — 110: تطبيع حالات MO + VALIDATE CONSTRAINT manufacturing_orders_status_check.
   — 111: تثبيت search_path على دالتَي الانحرافات (إغلاق تحذيري Advisor).
   — 110: تطبيع حالات MO (in-progress→in_progress, quality-check→quality_check) + VALIDATE CONSTRAINT.
4. **✅ حُسم تعارض مسار التسليم (Migration 87) ثم تحصينه (88)**: القانوني هو
   **`products`** (كل مفاتيح product_id الأجنبية تشير إليه؛ `items` جدول ميت فارغ)
   و**`org_id`** (112 جدولاً مقابل tenant_id على 13 محاسبياً). 87 واءم الدالة
   والخدمة بالكامل؛ **88 حصّنها** (تحقق عضوية + عزل org لكل استعلام + ملكية
   الفاتورة/السطر/المنتج + منع تسليم زائد + idempotency + COGS **fail-closed**).
   **89** يوفّر استلاماً ذرّياً مماثلاً (رأس+سطور+GRNI fail-closed). كلاهما مُختبَر
   بـ rollback حيّ. **✅ أُغلقت ذرّية المخزون (Migration 94)**: نُقل دفتر المخزون
   (SLE + bins + طابور FIFO/LIFO + التقييم) من خطوات الواجهة المنفصلة إلى **داخل**
   `rpc_post_goods_receipt` عبر `wardah_apply_stock_incoming` (قفل صف bin FOR UPDATE
   ⇒ لا سباق قراءة/كتابة)، فصار مستند+PO+GRNI+SLE+bin **معاملة ذرّية واحدة Fail-closed**.
   الواجهة تتخطّى خطوة الـ SLE في المسار الأساسي وتُبقيها للـ fallback فقط. **✅ 94
   مطبَّقة ومُختبرة حيّاً**: WA/FIFO/LIFO تطابق محرّك `services/valuation` (رصيد/سعر/طابور)،
   وGRNI يظل متزناً، وidempotency لا يُكرّر SLE؛ والاختبار الحيّ كشف وأصلح علة: عند غياب
   صف bin يضبط `SELECT INTO` كل المتغيّرات NULL ⇒ عولجت بـ COALESCE بعد الجلب.
5. **✅ حُسم تعارض آلة حالات التصنيع (Migration 92) ثم إتمام ذرّي (93)**: 92 صحّح
   أعمدة التواريخ الميتة (`mo_number/date_started/date_finished` ⇒
   `order_number/start_date/completed_date`) في `rpc_transition_mo_status` و
   `trg_mo_status_machine` (كانت آلة الحالات معطوبة كلياً كتعارض التسليم في 87)، وأضاف
   تحقق عضوية. **93** يجعل الإتمام **ذرّياً ومالياً**: تكلفة WIP الفعلية المتراكمة من
   `material_consumption` ⇒ زيادة مخزون المنتج التام (متوسط مرجّح) + سلسلة قيود
   `MATERIAL_ISSUE` (مدين WIP 134100/دائن مواد) و`FG_RECEIPT` (مدين تام 135100/دائن
   WIP 134100) **Fail-closed** + حالة `done` + **idempotent** (لا إتمام مزدوج). الواجهة:
   `updateManufacturingOrderStatus` توجّه الإتمام (`completed`/`done`) لـ
   `rpc_complete_manufacturing_order` (RPC أولاً، fallback خارج الإنتاج، **Fail-closed
   في الإنتاج**). الأجور/الأوفرهيد/الفروق وWIP متعدد المراحل: بناء لاحق (أحداث WIP إضافية).
6. **مؤجَّل (دفعة مواءمة تالية)**: خدمات أخرى ما زالت تشير إلى `items` القديم للقراءة
   فقط (financial-dashboard, sales-reports, gemini-financial, بعض manufacturing/*).
   لوحات/تقارير غير حرجة — تُواءم على حدة مع تشغيل التطبيق.
7. **✅ حُسم انفصال نظامَي المخزون (Migration 97)**: كان إكمال التصنيع (93) يكتب
   المنتج التام إلى `products.stock_quantity`، والاستلام (94) يكتب إلى `bins` فقط ⇒
   قيمتان منفصلتان لا تراهما التقارير معاً (products=18,200 تام، bins=3,250 خام).
   **القرار (الخيار B)**: `products` هو **المجمّع المرجعي** للمخزون الذي تقرؤه
   التقارير/اللوحة/تقييم المخزون؛ و`bins` يبقى دفتر التقييم/الطابور المفصّل (FIFO/
   LIFO/متوسط) دون تغيير لدوره. لكل منتج **له صف bin** تُشتقّ
   `products.stock_quantity`/`cost_price` من مجموع `bins` عبر المخازن **داخل**
   `wardah_apply_stock_incoming` (اشتقاق idempotent، لا مضاعفة) + تسوية لمرة واحدة
   للـ bins السابقة. المنتجات التامة (بلا bin) تبقى بقيمة إكمال التصنيع. **افتراض
   موثَّق**: منتج «هجين» يُصنَّع ويُستلَم معاً نادر؛ عندئذ يسود اشتقاق bins — التوحيد
   الكامل (كتابة bin للتام عند الإتمام) بناء لاحق. مطبَّقة ومُختبرة حيّاً (المجموع
   الموحَّد 21,450؛ استلام إضافي ⇒ bins=products متطابقان).
