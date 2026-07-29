# Wardah Process Costing — Project Manifest

**آخر تحديث موثق:** 2026-07-19  
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
الحالة الحية الموثقة بعد Baseline المولد في 2026-07-29:

- Baseline الحالي: `000_schema_baseline_20260729_072509.sql`, cutoff 148.
- Production: مطبقة حتى 148 (`148_uom_purchase_receipt_snapshots`).
- Repository: أعلى migration مرقمة هي 148.
- Fresh DB: لا توجد migrations معلقة بعد cutoff عند لحظة التوليد.
- لا تعدّ أي migration مطبقة حيًا لمجرد نجاح Fresh DB؛ سجل Production هو المرجع.
<!-- DATABASE_STATE_END -->

استثناءات سجل Production التاريخية محفوظة دون تعديل في:
`sql/migrations/migration_ledger_exceptions.json`:

- 101 و102 طُبقتا مرتين بإصدارات زمنية محددة؛ أي تكرار إضافي يفشل التدقيق.
- سجل 121 يحمل الاسم التاريخي `fail_closed_tenant_isolation` ويطابق قانونيًا الملف `121_fail_closed_tenant_isolation.sql`.

المراجع:

- `sql/migrations/STATUS_122_124.md` — اسم تاريخي، والمحتوى ممتد حتى 127.
- `docs/db/INTEGRITY_HARDENING_122_124_RUNBOOK.md`
- `docs/db/INTEGRITY_HARDENING_125_127_ADDENDUM.md`
- `docs/db/BASELINE_PRODUCTION_CUTOFF_POLICY.md`
- `docs/db/UOM_PARTIAL_RECEIPT_148_RUNBOOK.md` — 148: الاستلام الجزئي وبوابة
  اعتماد أمر الشراء وعقد الكميات حسب الجودة. يتضمن **ترتيب النشر الإلزامي حين
  تقترن migration بواجهة خلف علم مفعّل**.

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

النطاق: `modules` (10) · `permissions` (166) · `uom_categories` (6) · `uoms` (17، `org_id IS NULL`) · `uom_aliases` (59، `org_id IS NULL`) = 258 صفًا. و`journals` و`manufacturing_stages` و`roles` مستبعدة لأنها org-scoped، ومصدرها onboarding لا الـBaseline.

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

## Secrets

- `SUPABASE_DB_URL`: baseline workflow + تدقيق سجل Production للقراءة فقط.
- `SONAR_TOKEN`: SonarCloud.
- E2E: staging URL وحسابات اختبار.

لا تطبع أو تحفظ كلمات المرور في الوثائق أو commits.
