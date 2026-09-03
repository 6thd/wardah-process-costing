# Wardah Process Costing — Project Manifest

**آخر تحديث موثق:** 2026-09-03
**Repository:** `6thd/wardah-process-costing`  
**Supabase project:** `uutfztmqvajmsxnrqeiv`

## القاعدة الذهبية

لا تحذف جدولًا أو عمودًا أو migration أو Baseline أو بيانات تاريخية لمعالجة مشكلة. فضّل دائمًا:

- additive migrations.
- `CREATE OR REPLACE FUNCTION`.
- أعمدة nullable للمواءمة.
- RPC ذرية وFail-closed.
- عكس قانوني موثق بدل تعديل أو حذف التاريخ.

أي تغيير Production يمر عبر PR وCI وrunbook واختبارات قبل/بعد التطبيق.

## Stack

React 18 + TypeScript + Vite، shadcn/ui + Tailwind، Zustand + TanStack Query، Supabase/PostgreSQL 17، Vitest + Playwright، GitHub Actions، ونشر خارجي عبر Vercel/Netlify.

## افصل حالات قاعدة البيانات

1. **Repository latest migration:** أعلى ملف مرقم في `sql/migrations/`.
2. **Fresh DB:** Baseline + migrations الأحدث من cutoff.
3. **Production:** سجل `supabase_migrations.schema_migrations`.

<!-- DATABASE_STATE_START -->
الحالة الحية الموثقة بعد Baseline المولد في 2026-09-03:

- Baseline الحالي: `000_schema_baseline_20260903_083805.sql`, cutoff 186.
- Production: مطبقة حتى 186 (`186_stock_moves_contract_repair`).
- Repository: أعلى migration مرقمة هي 186.
- Fresh DB: لا توجد migrations معلقة بعد cutoff عند لحظة التوليد.
- لا تعدّ أي migration مطبقة حيًا لمجرد نجاح Fresh DB؛ سجل Production هو المرجع.
<!-- DATABASE_STATE_END -->

الكتلة أعلاه مملوكة بالكامل لـ`scripts/ci/update_baseline_docs.py` وتُستبدل عند كل
توليد Baseline. أي تحقق أو فجوة لاحقة للّقطة يجب أن تُسجّل في المراجع خارج الماركرين
حتى لا يمحوها التشغيل التالي بصمت.

استثناءات سجل Production التاريخية محفوظة دون تعديل في:
`sql/migrations/migration_ledger_exceptions.json`:

- 101 و102 طُبقتا مرتين بإصدارات زمنية محددة؛ أي تكرار إضافي يفشل التدقيق.
- سجل 121 يحمل الاسم التاريخي `fail_closed_tenant_isolation` ويطابق قانونيًا الملف `121_fail_closed_tenant_isolation.sql`.
- سجل 163 يحمل الاسم التاريخي `payment_voucher_guarded_draft_inserts` (version `20260731102524`) ويطابق قانونيًا الملف `163_payment_voucher_atomic_draft_creation.sql`. **ظل هذا الاستثناء غير معلن حتى 2026-08-09، فكان `Audit Production Migration Ledger` يفشل مغلقًا في كل تشغيل** برسالة `has no exact repository file … and no documented alias`. الصفّ الحي لم يُمسّ.

المراجع:

- `sql/migrations/STATUS_122_124.md` — اسم تاريخي، والمحتوى ممتد حتى 127.
- `docs/db/INTEGRITY_HARDENING_122_124_RUNBOOK.md`
- `docs/db/INTEGRITY_HARDENING_125_127_ADDENDUM.md`
- `docs/db/BASELINE_PRODUCTION_CUTOFF_POLICY.md`
- `docs/db/UOM_PARTIAL_RECEIPT_148_RUNBOOK.md` — 148: الاستلام الجزئي وبوابة
  اعتماد أمر الشراء وعقد الكميات حسب الجودة. يتضمن **ترتيب النشر الإلزامي حين
  تقترن migration بواجهة خلف علم مفعّل**.
- `docs/db/AP_THREE_WAY_MATCH_149_152_RUNBOOK.md` — 149–152: المطابقة الثلاثية،
  idempotency، hardening أمني، وترتيب تطبيق Production الإلزامي
  `149 → 150 → 151 → 152` مع فحوص قبل/بعد التطبيق.
- `docs/db/VOUCHER_RESET_166_RUNBOOK.md`، `docs/db/VOUCHER_ALLOCATION_167_RUNBOOK.md`،
  `docs/db/VOUCHER_ATOMIC_LIFECYCLE_168_RUNBOOK.md` — 166–168: انتقال دورة سندات
  القبض والصرف إلى RPCs ذرية (Create/Edit/Post/Reset/Cancel).
- `docs/db/VOUCHER_WRITE_CLOSURE_169_RUNBOOK.md` — 169: إغلاق سطح الكتابة المؤقت
  على رؤوس السندات وأسطر التخصيص وحقول الدفع المشتقة عبر حارس مزدوج (مالك RPC
  موثوق + GUC محلي للمعاملة معًا، لا GUC وحده).
- `docs/db/PERMISSION_HARDENING_170_173_CHAIN.md` — **170–173 مجتمعة**: العرض
  المركّب لسلسلة عزل المستأجرين وتشديد `has_permission()`. ثلاث migrations تستبدل
  **الدالة نفسها**، فالعقد الحي هو اتحادها لا آخرها؛ اقرأ هذا الملف قبل أي تعديل
  لاحق على `has_permission`. يتضمن الحالة الحية المتحقَّقة، وما لم تغيّره السلسلة
  عمدًا (تجاوز org admin — Issue #93).
- `docs/db/SENSITIVE_PERMISSIONS_174_RUNBOOK.md` — 174: فئة الصلاحيات الحساسة عبر
  مصنّف مركزي، وتضييق تجاوز org admin، وRPCs ذرية لإدارة الأدوار والتعيينات مع
  `rpc_permission_snapshot` مصدرًا وحيدًا لقرارات الواجهة. يتضمن **المعاملة التشغيلية
  الإلزامية قبل التطبيق** وترتيب Production السباعي.
- `docs/db/TENANT_ISOLATION_170_RUNBOOK.md`، `docs/db/AI_USAGE_DAILY_171_RUNBOOK.md`،
  `docs/db/HAS_PERMISSION_172_RUNBOOK.md`، `docs/db/HAS_PERMISSION_173_RUNBOOK.md`
  — تفصيل كل migration على حدة.
- `docs/db/RBAC_CONSUMER_175_RUNBOOK.md` — **Migration 175 (مطبّقة على Production،
  تحقق `20260811132302`)**: لا تسحب منح الجداول، لكنها ترفض تعيين دور بلا
  عضوية نشطة عند حدّ قاعدة البيانات، وتغلق سباق آخر مسؤول بقفل مشترك على صف
  المؤسسة. تضيف `rpc_remove_org_member` الذرية المدقَّقة، وتحصّن فرعي المنح
  الصريحة في دالتي الصلاحيات، وتُلحق سجل تدقيق بـ`create_role_from_template`.
  أتت بعدها Migration 176 لإغلاق الكتابة المباشرة على `roles` و`role_permissions`
  و`user_roles` بعد نجاح مسار المستهلك، فلا تعتبر 176 مؤجلة أو محجوزة بعد الآن.
- `sql/migrations/176_rbac_direct_write_closure.sql` +
  `.github/workflows/rbac-direct-write-176-acceptance.yml` — **Migration 176
  (مطبّقة على Production، `20260823091140`)**: إغلاق الكتابة المباشرة الموثقة على
  جداول RBAC الثلاثة مع قبول Fresh DB مخصص. لا توجد runbook مستقلة لـ176؛ هذه
  الملفات هي المرجع القانوني الحالي ولا يُنشأ رابط توثيقي غير موجود.
- `docs/db/GOODS_RECEIPT_NUMBER_SEQUENCE_177_RUNBOOK.md` — **Migration 177
  (مطبّقة على Production، `20260822084608`)**: إصلاح تصادم مولّد أرقام سندات
  الاستلام الذي كشفه Pilot الإنتاجي لـIssue #45 بعد أول استلام جزئي. تستخدم عدّادًا
  عالميًا يطابق قيد التفرد العالمي، وتُبقي عقد 148 الذرّي والسلوك الوظيفي دون تغيير.
- `sql/migrations/178_journal_rbac_and_canonical_manual_lifecycle.sql` +
  `scripts/ci/fresh-db/acceptance_178_journal_rbac.sql` +
  `.github/workflows/journal-rbac-178-acceptance.yml` — **Migration 178
  (مطبّقة على Production، `20260823205023`)**: حدّ قاعدة البيانات للقيود اليدوية
  القانونية على `gl_entries`، وإغلاق البدائيات العامة/التاريخية أمام العميل مع
  إبقاء RPCs create/post/reverse اليدوية القانونية متاحة لـ`authenticated`.
  لا توجد runbook مستقلة لـ178 في `docs/db` حاليًا؛ لا تستنتجها أو تخترع اسمًا لها.
- `docs/db/GL_IDEMPOTENCY_179_RUNBOOK.md` — **Migration 179 (مطبّقة على Production،
  `20260824133648`)**: تثبيت idempotency للـGL بشكل race-safe مع إعادة تثبيت إغلاق
  `rpc_create_journal_entry(jsonb)` عن `PUBLIC` و`anon` و`authenticated`.
- `docs/db/LEGACY_JOURNAL_APPROVAL_180_RUNBOOK.md` — **Migration 180 (مطبّقة على
  Production، `20260824201045`)**: سحب كل وصول غير مالك إلى سطح اعتماد القيود
  التاريخي (`journal_entry_approvals` والدالتان القديمتان) مع إبقاء الكائنات والبيانات
  التاريخية في مكانها، ودون تغيير دورة `gl_entries` القانونية.
- `docs/db/SUPPLIER_INVOICE_CANDIDATE_READ_181_RUNBOOK.md` — **Migration 181
  (مطبّقة على Production، `20260826112454`)**: تضيف عقد القراءة
  `rpc_list_supplier_invoice_candidates` لمرشحي فواتير المورد المطابقين لـPO/GRN؛
  الحارس يتطلب عضوية نشطة وصلاحيتي D4 معًا، وEXECUTE متاح فقط لـ`authenticated`،
  بينما يبقى `PUBLIC` و`anon` و`service_role` مرفوضين. تحقق ما بعد التطبيق أثبت
  نجاح استدعاء read-only تحت سياق مستخدم مصادق وإرجاع مرشحين حقيقيين دون أي كتابة
  تجارية. لا يعني تطبيق 181 أن PR الواجهة التالي جاهز للدمج؛ يبقى ترتيب DB-first
  للواجهة قائمًا، كما تبقى خرائط GL المطلوبة خطوة مستقلة قبل أي pilot للكتابة.
- `docs/db/TRIAL_BALANCE_LEDGER_TRUTH_182_RUNBOOK.md` — **Migration 182 (مطبّقة
  على Production، `20260828214043`)**: تنقل `rpc_get_trial_balance` من
  `journal_entries/journal_lines` التاريخيين إلى `gl_entries/gl_entry_lines`
  القانونيين، وتضيف أرصدة افتتاحية حسب السنة المالية وتحفظ الحسابات المعطلة
  والأسطر التاريخية ذات `account_id IS NULL`. تحقق Production بهوية
  `authenticated` أعاد 12 حسابًا متوازنة وصفر اختلافات عن الحساب القانوني المستقل؛
  دوران الدفتر `30,805.00` لكل جانب وصافي أرصدته `27,685.00`، والفرق `3,120.00`
  يساوي `SUM(LEAST(debit, credit))` داخل الحسابات. تحذير Supabase Advisor من
  `SECURITY DEFINER` الممنوحة لـ`authenticated` هو **SEC-172** نفسه، وقد أغلقته
  Migration 183 لاحقًا. بوابة `Trial Balance Ledger Truth` مفروضة بوضع
  `RPC_CONTRACT=enforced`.
- `docs/db/TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md` — **182 و183 مجتمعتان**:
  الـmigrationان تستبدلان **الدالة نفسها** `rpc_get_trial_balance(uuid, date)`،
  فالعقد الحي هو اتحادهما لا آخرهما — جسم الدفتر القانوني من 182 وطبقة صلاحية
  القراءة المالية من 183. إعادة جسم 182 وحده تعيد فتح التسريب الأمني، وإعادة طبقة
  183 فوق جسم قديم تعيد التقرير إلى الدفتر التاريخي الخاطئ. اقرأ هذا الملف قبل أي
  `CREATE OR REPLACE` لاحق على الدالة، تمامًا كسلسلة 170–173.
- `docs/db/FINANCIAL_REPORT_READ_RBAC_183_RUNBOOK.md` +
  `scripts/ci/fresh-db/acceptance_183_financial_report_read_rbac.sql` +
  `.github/workflows/financial-report-rbac-183-acceptance.yml` — **Migration 183
  (مطبّقة على Production، `20260829105053`)**: تحسم SEC-172 بتشديد أربعة حدود قراءة
  مالية عبر `wardah_178_assert_permission` بمفاتيح موجودة في كتالوج RBAC، وتشترط
  `reports.financial.read` بعد حارس العضوية، وتسحب القراءة المباشرة من
  `v_trial_balance` عن `authenticated` و`anon` فلا يبقى عرض `SECURITY INVOKER`
  مسارًا موازيًا يكتفي بعزل المستأجر. تعيد إنتاج جسم 182 كاملًا؛ لا تقرأها منفردة.
- `docs/db/GL_POSTING_INTEGRITY_184_RUNBOOK.md` +
  `scripts/ci/fresh-db/acceptance_184_gl_posting_integrity.sql` +
  `.github/workflows/gl-posting-integrity-184-acceptance.yml` — **Migration 184
  (مطبّقة على Production، `20260829133146`)**: كل قيد لمسته المعاملة وحالته
  `posted` يجب أن ينهيها بسطرين قانونيين على الأقل، متوازنين، ومساويين لإجمالي
  الرأس. توسّع `check_balance_before_post` إلى `BEFORE INSERT OR UPDATE`، وتضيف
  **أول `CREATE CONSTRAINT TRIGGER` في المخطط** (`DEFERRABLE INITIALLY DEFERRED`
  على `gl_entries` و`gl_entry_lines`) ليمر المسار الذري رأسًا-أولًا. دالة الحارس
  `SECURITY DEFINER` **عمدًا**: الحدث المؤجل يُقيَّم عند `COMMIT` بعد عودة الـRPC
  إلى `authenticated`، فلو بقيت `SECURITY INVOKER` لأخفت RLS قيد مؤسسة أخرى
  وتحوّل `NOT FOUND` إلى تجاوز صامت للعقد — والقبول يثبت ذلك حيًا بمستخدم عضو في
  مؤسستين بلا claim. لا تعالج القيود التاريخية الثلاثة المرحّلة بلا أسطر
  (`JE-2025-11-0001/2/3`، 9,955.00 لكل جانب)؛ وبعد 184 صار أي `UPDATE` منفرد على
  أحد رؤوسها يُرفض بـ`POSTED_ENTRY_LINES_MISSING`، فأي معالجة لاحقة تُدخل الأسطر
  الموثوقة والتعديل داخل المعاملة الذرية نفسها.
- `sql/migrations/185_stock_write_surface_closure.sql` +
  `scripts/ci/fresh-db/acceptance_185_stock_write_surface_closure.sql` +
  `.github/workflows/stock-write-surface-185-acceptance.yml` — **Migration 185
  (مطبّقة على Production، `20260830081533`)**: تغلق كتابة العميل المباشرة على
  `stock_ledger_entries` و`bins` مع إبقاء قراءة `authenticated` ومسارات الـRPC
  الذرية، وتسحب `anon/PUBLIC` من `consume_materials_for_mo` و
  `update_warehouse_gl_mapping`. لا تشمل `warehouses` ولا تصلح بيانات تاريخية.
- `docs/architecture/INVENTORY_CONSUMER_INVENTORY_20260901.md` و
  `docs/ai-simulation-lab/INVENTORY_INTEGRITY_PROGRESS_20260902.md` — جرد Round 3
  الحالي وحدود الانتقال إلى Phase 0. يثبت الجرد أن `stock_moves` و
  `stock_movements` غير موجودين، ويفصل `bins.avg_rate` القديم عن حقل
  `simulate_cogs.avg_rate` الصحيح. هذا الجرد تاريخي؛ حالة 186 الحية موثقة أدناه.
- `sql/migrations/186_stock_moves_contract_repair.sql` +
  `docs/db/STOCK_MOVES_CONTRACT_186_RUNBOOK.md` — **Migration 186 (مدموجة عبر
  PR #213 ومطبقة على Production، `20260903083010`)**: لا تعيد
  إنشاء الجداول القديمة؛ تعيد توجيه الحجز والتحقق والاستهلاك إلى
  `stock_ledger_entries`/`bins` والـRPC الذري، تزيل المرآة الخاملة من إتمام
  التصنيع، وتجعل تقرير انحراف المواد غير القابل للحساب يفشل صراحةً بدل نتيجة
  فارغة مضللة. postflight الحي أثبت صفر مراجع `stock_moves`، وثبات بيانات
  المخزون، وSQLSTATE `0A000` للتقاعد؛ زوج Baseline cutoff 186 وُلد في run
  `33734325356` ونُشر عبر PR #214 المدموج عند `3ce8b295`.
- `sql/migrations/187_stock_adjustment_ledger_idempotency.sql` +
  `docs/db/STOCK_ADJUSTMENT_IDEMPOTENCY_187_RUNBOOK.md` — **اقتراح repository
  فقط؛ غير مدموج وغير مطبق على Production**: يصحح تعريف `INV-02` من قيد عالمي
  غير قانوني إلى حد prospective خاص بـStock Adjustment، يربط الحركة بسطر
  `stock_adjustment_items`، ويترك تكرار `ADJ-000001` التاريخي ذي المصدر المجهول
  دون حذف أو backfill تخميني. يحتاج قرار دمج مستقل ثم تفويض Production مستقل.

## Baseline

`.github/workflows/generate-baseline.yml` يقرأ سجل Production كاملًا ويمرره إلى `scripts/ci/validate_migration_ledger.py`. لا يستخدم أعلى رقم ملف بوصفه cutoff، ولا يعتمد مطابقة glob ملتبسة. اللقطات الجديدة تحمل timestamp وتُضاف دون حذف القديمة، وتصل إلى `main` عبر PR فقط بعد نجاح إعادة البناء النظيفة.

### الـBaseline طبقتان لا طبقة

```
000_schema_baseline_<stamp>.sql        ← البنية
001_system_reference_data_<stamp>.sql  ← البيانات المرجعية النظامية
```

الطابع الزمني متطابق، وMigration Governance يرفض انفصالهما. يُطبَّقان بهذا الترتيب دائمًا قبل أي migration أحدث من الـcutoff.

**السبب:** الطبقة الأولى تُولَّد بـ`pg_dump --schema-only`، فلا تحمل صفًا **بالبناء**. وحين يرتفع الـcutoff فوق migration بذرت بيانات مرجعية، تُطوى كمخطط فقط وتضيع بذرتها. حدث ذلك مع 130 و140: صارت كل Fresh DB تُبنى بجداول UoM فارغة بينما Production يحمل 82 صفًا، ولم تكشفه أي بوابة لأن فحوص ما بعد الـBaseline تعدّ الجداول والدوال والسياسات ولا تعدّ صفًا.

والفراغ لا ينتج «بيانات ناقصة» بل **يقلب حراسًا إلى fail-open**: `rpc_create_org_uom` تقرأ الصفوف النظامية لترفض اختطاف رمز محجوز (`SYSTEM_UOM_CODE_RESERVED`) أو مرادف محجوز (`SYSTEM_UOM_ALIAS_RESERVED`)، وكلا الشرطين يمر خاويًا بلا بذرة — وقد أُثبت عمليًا بإنشاء وحدة بالرمز `PCS` على قاعدة بلا لقطة.

**لا تعالج هذا بـmigration جديدة.** تدوم دورة baseline واحدة ثم تُطوى بدورها فتعود الفجوة — وهو ما حدث بـ130 و140 أصلًا.

العقد في `sql/baseline/system_reference_manifest.yml`: allowlist صريحة بـpredicate صريح لكل جدول، وأعمدة متوقعة، وترتيب تصدير حسب المفاتيح الأجنبية، ومفاتيح ترتيب، وحدود دنيا. `pg_dump --data-only` مرفوض: `uoms` و`uom_aliases` تحملان صفوف مؤسسات مخصصة لا مكان لها في لقطة عامة.

النطاق عند لقطة cutoff 186: `modules` (10) · `permissions` (171) · `uom_categories` (6) · `uoms` (17، `org_id IS NULL`) · `uom_aliases` (59، `org_id IS NULL`) = 263 صفًا. و`journals` و`manufacturing_stages` و`roles` مستبعدة لأنها org-scoped، ومصدرها onboarding لا الـBaseline.

**هذه الأعداد لقطة لا ثابت، وقد شاخت هنا فعلًا.** `permissions` صار 171 اعتبارًا من لقطة `001_system_reference_data_20260826_131415.sql` وبقي كذلك في لقطات 182 و184 و185 و186، بينما ظل هذا السطر يقول 166 و258 حتى 2026-08-30 — ثلاث دورات توليد. ولم تكشفه بوابة: الـmanifest يفرض **حدودًا دنيا** وبصمة محتوى، فارتفاع العدد يمر بحكم التصميم، والنص هنا نثر بشري خارج ماركري `DATABASE_STATE` فلا يلمسه المولّد. أي مقارنة تعتمد هذا السطر تحتاج تحقّقًا من اللقطة الفعلية ومن `sql/baseline/system_reference_manifest.yml` أولًا، وأي لقطة جديدة توجب تحديثه يدويًا في PR الـBaseline نفسه.

(المفاتيح الخمسة الزائدة لم تأتِ من 182 أو 183 أو 184 أو 185 أو 186 — لا واحدة منها تُدرج صفًا في `permissions`؛ 183 تشترط مفاتيح موجودة فقط. مصدرها أسبق ولم يُثبت هنا، فلا تُنسب إلى migration بعينها دون تدقيق.)

الحراسة ثلاث طبقات: حدّ أدنى لكل جدول (يكشف الفراغ لا التبديل)، وبصمة محتوى لكل جدول (تكشف تبديل صف بعدد ثابت؛ أعمدة الزمن مستثناة من البصمة لا من التصدير)، واختبارات دلالية تثبت السلوك المعتمد على البيانات لا وجودها. التفاصيل في `sql/baseline/README.md`.

## Generated Columns

المخطط يحتوي 22 عمودًا `GENERATED ALWAYS AS ... STORED` وقت Baseline 121، منها:

- `bins.projected_qty`
- `stage_wip_log.cost_total`
- `stock_ledger_entries.posting_datetime`
- `sales_invoices.balance`
- `supplier_invoices.balance`
- `sales_invoice_lines.line_total`
- `purchase_order_lines.line_total`

لا ترسل Generated Columns في `INSERT` أو `UPDATE`. لا تستخدم `SELECT *` ثم spread كاملًا لإعادة الإدخال.

## Inventory architecture

- `stock_ledger_entries`: سجل الحركة القانوني.
- `bins`: الرصيد والتقييم حسب المنتج والمخزن.
- `products.stock_quantity`: مجمع مرجعي مشتق من bins للمنتجات ذات bins.
- `gl_entries/gl_entry_lines`: الدفتر المحاسبي القانوني.
- `journal_entries/journal_lines`: تاريخي، لا تنشئ مسارًا جديدًا عليه.

الكتابة التشغيلية يجب أن تكون داخل RPC ذرية واحدة. لا تفصل SLE وbin وproduct وGL إلى طلبات مستقلة.

PR #32 أضاف أو حسّن:

- `rpc_create_stock_adjustment`
- `rpc_submit_stock_adjustment`
- `rpc_cancel_stock_adjustment`
- `rpc_manual_stock_movement`
- `rpc_consume_reserved_materials`
- helper داخلي `wardah_apply_stock_outgoing`

قيمة GL لتسوية المخزون تُشتق من `stock_ledger_entries.stock_value_difference` الفعلية، لا من تقدير الواجهة. الحسابات القانونية:

- زيادة: مدين مخزون، دائن مكسب/فائض.
- نقص: مدين مصروف/خسارة، دائن مخزون.

## Security model

- RLS على جداول المؤسسات.
- `wardah_assert_org_member` و`wardah_assert_org_admin` للحراسة.
- العضوية النشطة تعني `is_active IS TRUE`.
- دوال `SECURITY DEFINER` الجديدة تحتاج حارسًا معروفًا أو سحب EXECUTE من PUBLIC والعملاء.
- helpers الداخلية لا تُمنح لـ`anon` أو`authenticated`.

`scripts/ci/check_definer_guards.py` يفحص migrations الأحدث من cutoff بحثًا عن مرجع حارس معروف أو سحب PUBLIC. لا يثبت ترتيب أول statement أو صحة المنطق كاملة؛ المراجعة البشرية والاختبارات السلبية لازمة.

### عقد `has_permission()` الحي بعد 173

الدالة `public.has_permission(uuid, uuid, varchar)` هي اتحاد ثلاث migrations لا آخرها
(170 حارس هوية المستدعي، 172 مطابقة تامة للمفتاح، 173 اشتراط دور نشط)، بالإضافة إلى
انتهاء صلاحية الدور ونطاق المؤسسة الموروثَين. أي `CREATE OR REPLACE` لاحق يجب أن يعيد
تثبيت الطبقات الخمس جميعًا — تفصيلها وفحص ما بعد التطبيق المركّب في
`docs/db/PERMISSION_HARDENING_170_173_CHAIN.md`.

**تجاوز org admin قائم ولم تغيّره السلسلة:** فرع `is_org_admin` لا يقرأ
`p_permission_key` إطلاقًا، فأي مسؤول مؤسسة نشط يجتاز **كل** مفتاح بما فيه المفاتيح
المحاسبية الحساسة (`unpost`/`cancel`/`reverse`). ينطبق ذلك على `has_permission`
و`wardah_has_exact_permission` معًا — الأخيرة «تامة» في المفتاح لا في التجاوز. ونتيجةً
لذلك **عدّ صفوف `role_permissions` لا يقيس الصلاحية الفعلية**؛ الفحص الصحيح هو استدعاء
دالة الصلاحية لكل مستخدم نشط.

**Migration 174 (مطبّقة على Production، تحقق `20260809112236`، سبقت 175 مباشرة)** تحسم Issue #93: مصنّف مركزي
واحد `wardah_is_sensitive_permission(text)` — `IMMUTABLE STRICT`، مفتاحان فقط
(`accounting.vouchers.unpost` و`accounting.vouchers.cancel`) — تستدعيه الدالتان معًا فلا
تتباعدان. Super Admin يحتفظ بالتجاوز الكامل؛ Org Admin يحتفظ به لكل المفاتيح العادية
وإدارة المستخدمين والأدوار، ويفقده للمفاتيح الحساسة فتحتاج منحًا صريحًا عبر دور نشط
غير منتهٍ — ويجوز لمسؤول المؤسسة إنشاء الدور ومنحه لنفسه، فتتحول السلطة من تجاوز خفي
إلى قرار صريح مُدقَّق في `audit_logs`. `accounting.vouchers.reverse` **غير موجود** حيًا ولا
في المستودع، ولم يُضَف افتراضيًا. التفاصيل وترتيب النشر الإلزامي في
`docs/db/SENSITIVE_PERMISSIONS_174_RUNBOOK.md`.

**الـLockout لم يكن احتمالًا نظريًا وقت صياغة 174:** وفق جرد 2026-08-09 (قبل كتابة أي
كود)، كان Super Admins = 0، وتعيينات الأدوار = 0، والمفتاحان ممنوحان لصفر دور — ودور
`Full Access` لا يحتويهما (166 من 169). لذلك يشترط الـrunbook (§6) إنشاء دور
`Financial Controller` ومنحه المفتاحين وتعيينه للمسؤول الحالي وإثبات
`via_explicit_grant = true` كخطوات تشغيلية **يجب أن تسبق** تطبيق 174، لا تتبعه؛ الـmigration
نفسها لا تتحقق منها برمجيًا (تتحقق فقط من وجود المفتاحين في `permissions`، لا من وجود
منح صريح). وهي بيانات org-scoped فمكانها معاملة تشغيلية موثقة، لا migration ولا Baseline.
يبقى هذا الإجراء المرجع الموثق لأي إعادة تطبيق أو تدقيق مستقبلي — لا إثبات بحد ذاته أن
الخطوات نُفذت بالفعل على Production.

## i18n

البوابة الحاجزة تمنع نمط legacy:

```text
isRTL ? 'نص عربي' : 'English text'
```

الفحص الموسع للنصوص العربية المباشرة في JSX وattributes إعلامي وليس بوابة صفر شاملة بعد.

## CI gates

1. i18n legacy gate.
2. generated types presence.
3. TypeScript.
4. ESLint.
5. unit/integration tests.
6. pglast migration syntax.
7. migration numbering.
8. migration governance: أسماء قانونية + أرقام غير مكررة + استثناءات سجل حية دقيقة + اقتران طبقتَي الـBaseline.
9. SECURITY DEFINER guard.
10. Fresh DB على PostgreSQL 17.
11. البيانات المرجعية النظامية: حدود دنيا + بصمة محتوى لكل جدول + رفض تسرب صفوف org-scoped.
12. قبول دلالي للبيانات المرجعية: حراسة UoM المحجوزة، وترابط RBAC وبنية مفاتيحه.
13. build.
14. SonarCloud Quality Gate عند توفر `SONAR_TOKEN`.

التدقيق الحي لسجل Production يعمل أسبوعيًا وبشكل يدوي عبر
`Audit Production Migration Ledger`، وهو قراءة فقط ويرفع Artifact لمدة 90 يومًا.

## E2E

Playwright يحتاج staging URL وحسابات اختبار منفصلة للأدوار والمؤسستين. لا تعتبر T4 مثبتة دون تشغيل فعلي وArtifact ناجح. لا تستخدم حسابات Production الحقيقية.

## Environment topology and Preview/Staging policy

اعتبارًا من 2026-08-27، بيئات الواجهة وقواعد البيانات منفصلة صراحةً. الهدف هو منع أي Preview أو PR تجريبي من الكتابة على Production، ومنع Staging من مطاردة كل commit على فروع العمل.

| طبقة النشر | مصدر الكود | قاعدة Supabase | قاعدة المزامنة |
|---|---|---|---|
| **Production** | `main` المستقر فقط | `Manufacturing Process` — `uutfztmqvajmsxnrqeiv` | سجل Production هو المرجع القانوني |
| **Preview العام / Staging** | آخر حالة مستقرة مدموجة في `main` | `Wardah-Staging` — حاليًا project ref `bhomjavdkzcvjyymzyla` | يطابق `main` المدموج فقط، لا HEAD لكل فرع |
| **Preview خاص بفرع/PR** | الفرع أو PR نفسه | Supabase branch/project معزول لذلك الاختبار عند وجود DB changes | يتبع ذلك PR فقط، ولا يُعتبر Staging الدائم |

قواعد التشغيل:

1. **Staging يطابق `main`، وليس آخر commit في أي فرع تطوير.** لا تُطبَّق عليه migration موجودة فقط في PR مفتوح.
2. أي PR واجهة فقط، ولا يعتمد على Schema/RPC جديدة، يمكنه استخدام Preview العام و`Wardah-Staging`.
3. أي PR يضيف أو يغيّر migration/RPC/RLS أو عقد قاعدة بيانات يحتاج بيئة Supabase معزولة وVercel Custom Preview Branch إذا كان الاختبار قبل الدمج مطلوبًا.
4. بعد دمج migration إلى `main`، حدّث Staging إلى نفس baseline/ledger المستقر ثم نفّذ smoke/acceptance؛ لا تجعل Staging يتقدم على `main`.
5. Production وPreview لا يشتركان في قيم Supabase. في Vercel يجب أن تكون `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` scoped منفصلة لـProduction وPreview. أي branch-specific Preview قد يملك override خاصًا به.
6. لا تستخدم `service_role` أو أي secret إداري في متغير يبدأ بـ`VITE_`. مفاتيح Vite تصل إلى المتصفح؛ المسموح فقط Project URL وanon/publishable key مع RLS وحراس قاعدة البيانات.
7. لا تستخدم حسابات Production الحقيقية في Preview/Staging أو E2E.
8. قبل أي Redeploy للـPreview العام، تحقق أن Staging وصل إلى baseline المطلوب من `main` وأن الفجوات المعروفة مغلقة. قبل أي Redeploy لـProduction، تحقق من أن متغيراته تشير فقط إلى Supabase Production.
9. اسم مشروع Staging الدائم يجب أن يبقى واضحًا تنظيميًا (`Wardah-Staging` مفضل). تغيير الاسم لا يغيّر `project_ref` أو URL.

ملاحظة تاريخية: المشروع `bhomjavdkzcvjyymzyla` أُنشئ أصلًا كـ`Wardah-E2E-PR114-a77f6d2` لاختبار معزول، ثم اختير ليصبح Staging العام بعد التحقق والتحديث. لا يُعتبر جاهزًا تلقائيًا لمجرد تغيير اسمه؛ يجب إثبات تطابقه مع `main` المستقر قبل الاعتماد.

## Migration workflow

1. ابدأ من أحدث `main`.
2. اسم الملف إلزاميًا `NNN_snake_case.sql`، والاسم المرسل إلى `apply_migration` يساوي stem الملف كاملًا.
3. أضف migration جديدة؛ لا تغيّر migration مطبقة حيًا.
4. حدث runbook/status.
5. شغّل CI وFresh DB وMigration Governance.
6. راجع SQL أمنيًا ووظيفيًا.
7. **إذا اعتمدت الواجهة على RPC أو Schema جديدة، افصل التغيير إلى PRين: ادمج PR الـMigration المتوافقة للخلف أولًا، ثم طبّقها على Production وتحقق منها، وبعد ذلك فقط ادمج PR الواجهة التابعة لها** (انظر أدناه).
8. ادمج PR الـMigration إلى `main`.
9. طبّق على Production بالترتيب. **لا تطبّق أبدًا SQL غير موجودة في `main`.**
10. نفذ استعلامات التحقق وتأكد من ظهور الاسم القانوني مرة واحدة في السجل.
11. ادمج PR الواجهة التابعة (إن وُجد) بعد نجاح الخطوة 10.
12. حدّث Baseline بعد ظهور migration في سجل Production فقط عبر workflow المخصص وPR مستقل.

لا تعدّل أو تحذف صفوف `supabase_migrations.schema_migrations` لتجميل التاريخ؛ وثّق الاستثناء بدقة واجعل الحارس يرفض أي انحراف جديد.

### ترتيب النشر: `repository-first` للـMigration ثم `DB-first` للواجهة

الدمج ينشر الواجهة تلقائيًا عبر Vercel/Netlify، **بينما قاعدة البيانات لا تتغير بالدمج**. فأي واجهة مدموجة تستدعي RPC أو Schema لم تُطبَّق بعد تكون معطّلة عند كل مؤسسة تصل إليها. القاعدة الناتجة لها شقّان لا يُفصل أحدهما عن الآخر:

1. **`repository-first` للـMigration:** الملف يصل إلى `main` قبل تطبيقه على Production. سجل Production هو المرجع القانوني، لكن `Audit Production Migration Ledger` و`Generate Schema Baseline` يقرآن `main` ويطالبان بملف مطابق تمامًا لكل صف حي؛ فتطبيق SQL غير مدموجة يجعل Production متقدمًا على المستودع ويُفشل التدقيق، وإن تعذّر دمج الـPR لاحقًا يصبح التقدّم دائمًا بلا ملف يقابله.
2. **`DB-first` للواجهة:** لا تُدمج واجهة تعتمد على RPC أو Schema قبل تطبيق الـmigration على Production والتحقق منها.

الشقّان معًا يعنيان أن **الـmigration والواجهة التي تعتمد عليها لا يُدمجان في PR واحد**: PR قاعدة بيانات مستقل يُدمج ويُطبَّق ويُتحقَّق منه، ثم PR الواجهة التابعة له.

| الحالة | القرار |
|---|---|
| Migration بلا واجهة تابعة | **دمج DB PR → تطبيق → تحقق** |
| واجهة تعتمد على RPC أو Schema جديدة | **دمج DB PR مستقل → تطبيق وتحقق → دمج UI PR** |
| يتعذر تجهيز DB أولًا، والعلم مطفأ للجميع | أبقِ UI PR غير مدموج، أو جمّد العلم واضمن تطبيق DB قبل تفعيله. **ولا تطبّق SQL غير موجودة في `main` في أي حال** |
| العلم مفعّل لأي مؤسسة | **يُمنع** دمج UI PR حتى اكتمال DB PR وتطبيقه |

فحص العلم يحدد **نطاق الخطر** لا ترتيب النشر؛ فحالته قد تتغير بين الدمج والتطبيق، وإطفاؤه احتواء مؤقت لا بديل دائم عن هذا الترتيب:

```sql
SELECT org_id, value FROM public.org_settings WHERE key = '<flag_key>';
```

حدثت هذه الفجوة فعلًا مع Migration 148؛ التفاصيل في `docs/db/UOM_PARTIAL_RECEIPT_148_RUNBOOK.md` §3.
وحدثت مرة أخرى بوجه مقلوب مع Migration 170: دُمجت في `main` عبر PR #98 بينما ظل سجل
Production عند 169، فبقيت الثغرات الثلاث **حية بالكامل** طوال تلك النافذة حتى التطبيق
الفعلي في 2026-08-06. **الدمج يغلق الفجوة في المستودع لا في Production؛ خطوة التطبيق هي
الإصلاح نفسه لا متابعة اختيارية.** في المقابل التُزم الترتيب مع 171 (تطبيق وتحقق في
2026-08-06، ثم دمج واجهة `reports-insights` في 2026-08-08 عبر #106 وما بعده) — وهو
النموذج المتَّبع. التفاصيل في `docs/db/PERMISSION_HARDENING_170_173_CHAIN.md` §6.

## Secrets

- `SUPABASE_DB_URL`: baseline workflow + تدقيق سجل Production للقراءة فقط.
- `SONAR_TOKEN`: SonarCloud.
- E2E: staging URL وحسابات اختبار.

لا تطبع أو تحفظ كلمات المرور في الوثائق أو commits.
